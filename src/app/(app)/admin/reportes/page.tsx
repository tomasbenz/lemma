// src/app/(app)/admin/reportes/page.tsx
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  obtenerKpisYVentasDiarias,
  obtenerTopProductos,
  obtenerDistribucionMediosPago,
  type PeriodoReporte,
} from '@/lib/queries/reportes'
import { ReportesView } from './_components/reportes-view'
import { ReportesSkeleton } from './_components/reportes-skeleton'

export const metadata = {
  title: 'Reportes',
}

type SearchParams = Promise<{ periodo?: string }>

const PERIODOS_VALIDOS: PeriodoReporte[] = [
  '7d',
  '30d',
  '90d',
  'mes_actual',
  'anio_actual',
]

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { periodo: periodoParam } = await searchParams
  const periodo: PeriodoReporte = PERIODOS_VALIDOS.includes(
    periodoParam as PeriodoReporte
  )
    ? (periodoParam as PeriodoReporte)
    : '30d'

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Reportes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas de ventas y productos en el período seleccionado.
          </p>
        </div>

        {/* Sin key={periodo} — así el Suspense no remonta en cada cambio.
            useTransition + opacity-60 en ReportesView ya da feedback visual. */}
        <Suspense fallback={<ReportesSkeleton />}>
          <ReportesContent periodo={periodo} />
        </Suspense>
      </div>
    </div>
  )
}

async function ReportesContent({ periodo }: { periodo: PeriodoReporte }) {
  const [kpisYVentas, topProductos, mediosPago] = await Promise.all([
    obtenerKpisYVentasDiarias(periodo),
    obtenerTopProductos(periodo, 10),
    obtenerDistribucionMediosPago(periodo),
  ])

  return (
    <ReportesView
      periodo={periodo}
      kpis={kpisYVentas.kpis}
      ventasPorDia={kpisYVentas.ventasPorDia}
      topProductos={topProductos}
      mediosPago={mediosPago}
    />
  )
}