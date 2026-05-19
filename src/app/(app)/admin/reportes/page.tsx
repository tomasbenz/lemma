// src/app/(app)/admin/reportes/page.tsx
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  obtenerKpisYVentasDiarias,
  obtenerTopProductos,
  obtenerDistribucionMediosPago,
  obtenerVentasAnuladas,
  type PeriodoReporte,
  type OpcionesReporte,
} from '@/lib/queries/reportes'
import { listarTurnos, obtenerTurno } from '@/lib/queries/turnos'
import { ReportesView, type TurnoOption } from './_components/reportes-view'
import { ReportesSkeleton } from './_components/reportes-skeleton'

export const metadata = {
  title: 'Reportes',
}

type SearchParams = Promise<{
  periodo?: string
  desde?: string
  hasta?: string
  turno_id?: string
}>

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

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const sp = await searchParams

  // Validar periodo
  const periodo: PeriodoReporte = PERIODOS_VALIDOS.includes(
    sp.periodo as PeriodoReporte
  )
    ? (sp.periodo as PeriodoReporte)
    : '30d'

  // Validar fechas personalizadas (solo se aplican si periodo === 'personalizado')
  const desde = sp.desde && FECHA_REGEX.test(sp.desde) ? sp.desde : null
  const hasta = sp.hasta && FECHA_REGEX.test(sp.hasta) ? sp.hasta : null

  // Validar turno_id: tiene que parecer un uuid v4-ish básico (36 chars con guiones)
  const turnoId =
    sp.turno_id && /^[0-9a-f-]{30,40}$/i.test(sp.turno_id) ? sp.turno_id : null

  // Listar últimos 20 turnos cerrados de la empresa actual (para el dropdown).
  const turnosListado = user.empresa_id
    ? await listarTurnos({
        estado: 'cerrados',
        porPagina: 20,
        pagina: 1,
      })
    : { rows: [], total: 0, pagina: 1, porPagina: 20 }

  const turnosOptions: TurnoOption[] = turnosListado.rows.map((t) => ({
    id: t.id,
    abierto_at: t.abierto_at,
    cerrado_at: t.cerrado_at,
    usuario_apertura_nombre:
      t.usuario_apertura?.nombre_completo ?? t.usuario_apertura?.email ?? null,
  }))

  // Si hay turnoId pero NO está en los últimos 20 turnos cerrados (ej. uno
  // viejo), traerlo por separado para poder mostrar el label en el dropdown.
  let turnoActivoOption: TurnoOption | null = null
  if (turnoId && !turnosOptions.some((t) => t.id === turnoId)) {
    const t = await obtenerTurno(turnoId)
    if (t) {
      turnoActivoOption = {
        id: t.turno.id,
        abierto_at: t.turno.abierto_at,
        cerrado_at: t.turno.cerrado_at,
        usuario_apertura_nombre:
          t.turno.usuario_apertura?.nombre_completo ??
          t.turno.usuario_apertura?.email ??
          null,
      }
    }
  }

  // Cuando hay turnoId: el rango de fechas se deriva del turno (override
  // del período). Si el turno está abierto, hasta=ahora.
  let opts: OpcionesReporte = {
    periodo,
    desde,
    hasta,
    turnoId,
  }

  if (turnoId) {
    const turnoParaRango =
      turnoActivoOption ?? turnosOptions.find((t) => t.id === turnoId) ?? null
    if (turnoParaRango) {
      // Convertir las fechas del turno a strings YYYY-MM-DD para usar
      // periodo='personalizado'. Si el turno está abierto, "hasta" es hoy.
      const desdeTurno = turnoParaRango.abierto_at.slice(0, 10)
      const hastaTurno = turnoParaRango.cerrado_at
        ? turnoParaRango.cerrado_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10)
      opts = {
        periodo: 'personalizado',
        desde: desdeTurno,
        hasta: hastaTurno,
        turnoId,
      }
    }
  }

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

        <Suspense fallback={<ReportesSkeleton />}>
          <ReportesContent
            opts={opts}
            periodoOriginal={periodo}
            desdeOriginal={desde}
            hastaOriginal={hasta}
            turnoId={turnoId}
            turnosOptions={
              turnoActivoOption
                ? [turnoActivoOption, ...turnosOptions]
                : turnosOptions
            }
          />
        </Suspense>
      </div>
    </div>
  )
}

async function ReportesContent({
  opts,
  periodoOriginal,
  desdeOriginal,
  hastaOriginal,
  turnoId,
  turnosOptions,
}: {
  opts: OpcionesReporte
  periodoOriginal: PeriodoReporte
  desdeOriginal: string | null
  hastaOriginal: string | null
  turnoId: string | null
  turnosOptions: TurnoOption[]
}) {
  const [kpisYVentas, topProductos, mediosPago, anuladas] = await Promise.all([
    obtenerKpisYVentasDiarias(opts),
    obtenerTopProductos(opts, 10),
    obtenerDistribucionMediosPago(opts),
    obtenerVentasAnuladas(opts),
  ])

  return (
    <ReportesView
      periodo={periodoOriginal}
      desde={desdeOriginal}
      hasta={hastaOriginal}
      turnoId={turnoId}
      kpis={kpisYVentas.kpis}
      ventasPorDia={kpisYVentas.ventasPorDia}
      topProductos={topProductos}
      mediosPago={mediosPago}
      anuladas={anuladas}
      turnosOptions={turnosOptions}
    />
  )
}
