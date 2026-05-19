'use server'

import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import {
  obtenerKpisYVentasDiarias,
  obtenerTopProductos,
  obtenerDistribucionMediosPago,
  obtenerVentasAnuladas,
  type PeriodoReporte,
  type OpcionesReporte,
} from '@/lib/queries/reportes'
import { obtenerTurno } from '@/lib/queries/turnos'
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

export type ExportarReportePdfInput = {
  periodo: string
  desde?: string | null
  hasta?: string | null
  turnoId?: string | null
  modo?: ModoPdf
}

type Resultado =
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string }

function formatLabelTurno(
  abierto_at: string,
  cerrado_at: string | null,
  nombreUsuario: string | null
): string {
  const abierto = new Date(abierto_at)
  const inicio = abierto.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const fin = cerrado_at
    ? new Date(cerrado_at).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'abierto'
  return nombreUsuario
    ? `${inicio} → ${fin} (${nombreUsuario})`
    : `${inicio} → ${fin}`
}

export async function exportarReportePdf(
  input: ExportarReportePdfInput
): Promise<Resultado> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }

    const periodo: PeriodoReporte = PERIODOS_VALIDOS.includes(
      input.periodo as PeriodoReporte
    )
      ? (input.periodo as PeriodoReporte)
      : '30d'

    const opts: OpcionesReporte = {
      periodo,
      desde: input.desde ?? null,
      hasta: input.hasta ?? null,
      turnoId: input.turnoId ?? null,
    }

    const modo: ModoPdf = input.modo === 'light' ? 'light' : 'dark'

    // Si el reporte es de un turno, traer el detalle para mostrar el label.
    const turnoData = input.turnoId ? await obtenerTurno(input.turnoId) : null
    const turnoLabel = turnoData
      ? formatLabelTurno(
          turnoData.turno.abierto_at,
          turnoData.turno.cerrado_at,
          turnoData.turno.usuario_apertura?.nombre_completo ??
            turnoData.turno.usuario_apertura?.email ??
            null
        )
      : null

    const [config, kpisYVentas, topProductos, mediosPago, anuladas] =
      await Promise.all([
        obtenerConfiguracion(),
        obtenerKpisYVentasDiarias(opts),
        obtenerTopProductos(opts, 10),
        obtenerDistribucionMediosPago(opts),
        obtenerVentasAnuladas(opts),
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
      kpis: kpisYVentas.kpis,
      ventasPorDia: kpisYVentas.ventasPorDia,
      topProductos,
      mediosPago,
      anuladas,
      turnoLabel,
    }

    const pdfBuffer = await renderToBuffer(
      createElement(ReportePdf, { data, modo }) as never
    )

    const suffix = modo === 'light' ? '-imprimible' : ''
    const turnoSuffix = input.turnoId ? '-turno' : ''
    const filename = `reporte-${periodo}${turnoSuffix}${suffix}-${
      new Date().toISOString().split('T')[0]
    }.pdf`

    const base64 = Buffer.from(pdfBuffer).toString('base64')

    return { ok: true, base64, filename }
  } catch (err) {
    console.error('[exportarReportePdf]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
