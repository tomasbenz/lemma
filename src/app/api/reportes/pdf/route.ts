import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import {
  obtenerKpis,
  obtenerVentasPorDia,
  obtenerTopProductos,
  obtenerDistribucionMediosPago,
  type PeriodoReporte,
} from '@/lib/queries/reportes'
import {
  ReportePdf,
  type ReportePdfData,
  type ModoPdf,
} from '@/lib/pdf/reporte-pdf'

const PERIODOS_VALIDOS: PeriodoReporte[] = [
  'hoy',
  'ayer',
  '7d',
  '30d',
  '90d',
  'mes_actual',
  'anio_actual',
  'personalizado',
]

const PERIODOS_LABEL: Record<PeriodoReporte, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  mes_actual: 'Mes actual',
  anio_actual: 'Año actual',
  personalizado: 'Personalizado',
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (user.rol === 'vendedor') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const periodoParam = searchParams.get('periodo') as PeriodoReporte | null
  const periodo: PeriodoReporte = PERIODOS_VALIDOS.includes(
    periodoParam as PeriodoReporte
  )
    ? (periodoParam as PeriodoReporte)
    : '30d'

  const modoParam = searchParams.get('modo')
  const modo: ModoPdf = modoParam === 'light' ? 'light' : 'dark'

  const [config, kpis, ventasPorDia, topProductos, mediosPago] =
    await Promise.all([
      obtenerConfiguracion(),
      obtenerKpis(periodo),
      obtenerVentasPorDia(periodo),
      obtenerTopProductos(periodo, 10),
      obtenerDistribucionMediosPago(periodo),
    ])

  const data: ReportePdfData = {
    empresa: {
      razon_social: config.razon_social,
      cuit: config.cuit,
    },
    periodoLabel: PERIODOS_LABEL[periodo],
    fechaGeneracion: new Date().toLocaleString('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    kpis,
    ventasPorDia,
    topProductos,
    mediosPago,
  }

  const pdfBuffer = await renderToBuffer(
    createElement(ReportePdf, { data, modo }) as never
  )

  const suffix = modo === 'light' ? '-imprimible' : ''
  const filename = `reporte-${periodo}${suffix}-${
    new Date().toISOString().split('T')[0]
  }.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}