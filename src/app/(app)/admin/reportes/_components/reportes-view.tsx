// src/app/(app)/admin/reportes/_components/reportes-view.tsx
'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp,
  Receipt,
  Package,
  Users,
  DollarSign,
  Download,
  FileText,
  FileSpreadsheet,
  Printer,
  Loader2,
  History,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatARS, formatNumber } from '@/lib/format'
import type {
  PeriodoReporte,
  KpisReporte,
  VentaPorDia,
  ProductoTop,
  MedioPagoAgregado,
  VentasAnuladasAgregado,
} from '@/lib/queries/reportes'
import { exportarReporteExcel } from '../_actions/exportar-reporte-excel'
import { exportarReportePdf } from '../_actions/exportar-reporte-pdf'
import { GraficoVentas } from './grafico-ventas'
import { GraficoMediosPago } from './grafico-medios-pago'

export type TurnoOption = {
  id: string
  abierto_at: string
  cerrado_at: string | null
  usuario_apertura_nombre: string | null
}

type Props = {
  periodo: PeriodoReporte
  desde: string | null
  hasta: string | null
  turnoId: string | null
  kpis: KpisReporte
  ventasPorDia: VentaPorDia[]
  topProductos: ProductoTop[]
  mediosPago: MedioPagoAgregado[]
  anuladas: VentasAnuladasAgregado
  turnosOptions: TurnoOption[]
}

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

// Orden visual de los presets en la barra (sin contar personalizado).
const PERIODOS_PRESET: PeriodoReporte[] = [
  'hoy',
  'ayer',
  '7d',
  '30d',
  '90d',
  'mes_actual',
  'anio_actual',
]

function formatTurnoLabel(t: TurnoOption): string {
  const abierto = new Date(t.abierto_at)
  const inicio = abierto.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const fin = t.cerrado_at
    ? new Date(t.cerrado_at).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'abierto'
  const usuario = t.usuario_apertura_nombre
    ? ` (Cajera: ${t.usuario_apertura_nombre})`
    : ''
  return `${inicio} → ${fin}${usuario}`
}

export function ReportesView({
  periodo,
  desde,
  hasta,
  turnoId,
  kpis,
  ventasPorDia,
  topProductos,
  mediosPago,
  anuladas,
  turnosOptions,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [exportando, startExportando] = useTransition()

  const hayTurnoActivo = Boolean(turnoId)

  function buildUrl(
    overrides: Partial<{
      periodo: PeriodoReporte
      desde: string | null
      hasta: string | null
      turno_id: string | null
    }>
  ): string {
    const params = new URLSearchParams()
    const nextPeriodo = overrides.periodo ?? periodo
    const nextDesde =
      overrides.desde === undefined ? desde : overrides.desde
    const nextHasta =
      overrides.hasta === undefined ? hasta : overrides.hasta
    const nextTurno =
      overrides.turno_id === undefined ? turnoId : overrides.turno_id

    if (nextPeriodo !== '30d') params.set('periodo', nextPeriodo)
    if (nextDesde) params.set('desde', nextDesde)
    if (nextHasta) params.set('hasta', nextHasta)
    if (nextTurno) params.set('turno_id', nextTurno)

    const q = params.toString()
    return q ? `/admin/reportes?${q}` : '/admin/reportes'
  }

  function cambiarPeriodo(nuevo: PeriodoReporte) {
    if (hayTurnoActivo) return // disabled mientras hay turno seleccionado
    startTransition(() => {
      // Cambiar de preset limpia desde/hasta personalizado.
      const limpiar = nuevo !== 'personalizado'
      router.replace(
        buildUrl({
          periodo: nuevo,
          desde: limpiar ? null : desde,
          hasta: limpiar ? null : hasta,
        }),
        { scroll: false }
      )
    })
  }

  function cambiarDesde(valor: string) {
    startTransition(() => {
      router.replace(
        buildUrl({ periodo: 'personalizado', desde: valor || null }),
        { scroll: false }
      )
    })
  }

  function cambiarHasta(valor: string) {
    startTransition(() => {
      router.replace(
        buildUrl({ periodo: 'personalizado', hasta: valor || null }),
        { scroll: false }
      )
    })
  }

  function cambiarTurno(valor: string) {
    startTransition(() => {
      if (valor === '__limpiar__' || !valor) {
        router.replace(buildUrl({ turno_id: null }), { scroll: false })
      } else {
        router.replace(buildUrl({ turno_id: valor }), { scroll: false })
      }
    })
  }

  function limpiarTurno() {
    cambiarTurno('__limpiar__')
  }

  function descargarBlob(base64: string, filename: string, mime: string) {
    const byteChars = atob(base64)
    const byteNumbers = new Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function descargarPdf() {
    startExportando(async () => {
      const result = await exportarReportePdf({
        periodo,
        desde,
        hasta,
        turnoId,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      descargarBlob(result.base64, result.filename, 'application/pdf')
      toast.success('PDF descargado')
    })
  }

  function descargarPdfImprimible() {
    startExportando(async () => {
      const result = await exportarReportePdf({
        periodo,
        desde,
        hasta,
        turnoId,
        modo: 'light',
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      descargarBlob(result.base64, result.filename, 'application/pdf')
      toast.success('PDF imprimible descargado')
    })
  }

  function descargarExcel() {
    startExportando(async () => {
      const result = await exportarReporteExcel(periodo)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      descargarBlob(
        result.base64,
        result.filename,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      toast.success('Excel descargado')
    })
  }

  const mostrarFechas = periodo === 'personalizado' && !hayTurnoActivo

  return (
    <div
      className={cn(
        'space-y-6 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      {/* Selector de período + turno + exportar */}
      <div className="space-y-3 enter-fade">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODOS_PRESET.map((p) => (
            <Button
              key={p}
              variant={p === periodo && !hayTurnoActivo ? 'default' : 'outline'}
              size="sm"
              onClick={() => cambiarPeriodo(p)}
              disabled={hayTurnoActivo}
            >
              {PERIODOS_LABEL[p]}
            </Button>
          ))}
          <Button
            variant={
              periodo === 'personalizado' && !hayTurnoActivo
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => cambiarPeriodo('personalizado')}
            disabled={hayTurnoActivo}
          >
            Personalizado
          </Button>

          <div className="flex-1" />

          {/* Dropdown de turno */}
          <Select
            value={turnoId ?? '__sin_turno__'}
            onValueChange={cambiarTurno}
          >
            <SelectTrigger size="sm" className="w-[220px] gap-1.5">
              <History className="size-3.5" />
              <SelectValue placeholder="Sin filtro de turno" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__sin_turno__">Sin filtro de turno</SelectItem>
              {turnosOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {formatTurnoLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hayTurnoActivo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarTurno}
              className="gap-1"
              aria-label="Quitar filtro de turno"
            >
              <X className="size-3.5" />
              <span className="sr-only">Quitar filtro</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exportando}>
                {exportando ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="size-3.5 mr-1.5" />
                )}
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={descargarPdf} disabled={exportando}>
                <FileText className="size-4 mr-2" />
                Descargar PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={descargarPdfImprimible}
                disabled={exportando}
              >
                <Printer className="size-4 mr-2" />
                Versión para imprimir
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={descargarExcel}
                disabled={exportando || hayTurnoActivo}
              >
                <FileSpreadsheet className="size-4 mr-2" />
                Exportar Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Inputs date para período personalizado */}
        {mostrarFechas && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Desde</span>
              <Input
                type="date"
                value={desde ?? ''}
                onChange={(e) => cambiarDesde(e.target.value)}
                className="w-[160px] h-8"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Hasta</span>
              <Input
                type="date"
                value={hasta ?? ''}
                onChange={(e) => cambiarHasta(e.target.value)}
                className="w-[160px] h-8"
              />
            </label>
            {(!desde || !hasta) && (
              <span className="text-xs text-muted-foreground">
                Elegí las dos fechas para activar el filtro.
              </span>
            )}
          </div>
        )}

        {hayTurnoActivo && (
          <p className="text-xs text-muted-foreground">
            Las métricas están filtradas por el turno seleccionado. El rango
            de fechas se deriva automáticamente.
          </p>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard
          icon={<Receipt className="size-4 text-muted-foreground" />}
          label="Ventas"
          valor={formatNumber(kpis.ventas_total)}
          stagger="stagger-1"
        />
        <KpiCard
          icon={<DollarSign className="size-4 text-muted-foreground" />}
          label="Total cobrado"
          valor={formatARS(kpis.ventas_total_cobrado)}
          destacado
          stagger="stagger-2"
        />
        <KpiCard
          icon={<Package className="size-4 text-muted-foreground" />}
          label="Unidades"
          valor={formatNumber(kpis.unidades)}
          stagger="stagger-3"
        />
        <KpiCard
          icon={<TrendingUp className="size-4 text-muted-foreground" />}
          label="Ticket promedio"
          valor={formatARS(kpis.ticket_promedio)}
          stagger="stagger-4"
        />
        <KpiCard
          icon={<Users className="size-4 text-muted-foreground" />}
          label="Clientes únicos"
          valor={formatNumber(kpis.clientes_unicos)}
          stagger="stagger-5"
        />
      </div>

      {/* Card de anuladas (solo si hay) */}
      {anuladas.cantidad > 0 && (
        <Card className="border-border/60 bg-muted/20">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground/80 font-medium">
                Ventas anuladas
              </p>
              <p className="text-sm text-muted-foreground font-numeric">
                {formatNumber(anuladas.cantidad)}{' '}
                {anuladas.cantidad === 1 ? 'venta' : 'ventas'}
                {' · '}
                {formatARS(anuladas.monto_total)} no cobrado
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gráfico de ventas */}
      <Card className="surface-1 enter-up stagger-2">
        <CardHeader>
          <CardTitle className="text-base">Ventas por día</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <GraficoVentas data={ventasPorDia} />
        </CardContent>
      </Card>

      {/* Top productos + Medios de pago */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="surface-1 enter-up stagger-3">
          <CardHeader>
            <CardTitle className="text-base">Top 10 productos</CardTitle>
          </CardHeader>
          <CardContent>
            {topProductos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay ventas en este período.
              </p>
            ) : (
              <div className="space-y-2">
                {topProductos.slice(0, 10).map((p, i) => (
                  <div
                    key={p.producto_sku}
                    className="flex items-center gap-3 p-2 rounded-md transition-colors duration-200 hover:bg-muted/40"
                  >
                    <span className="text-xs font-numeric font-medium text-muted-foreground w-6 text-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {p.producto_nombre}
                      </p>
                      <p className="text-xs text-muted-foreground font-numeric truncate">
                        {p.producto_sku}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-numeric font-medium">
                        {formatNumber(p.unidades)} u.
                      </p>
                      <p className="text-xs text-muted-foreground font-numeric">
                        {formatARS(p.monto)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="surface-1 enter-up stagger-4">
          <CardHeader>
            <CardTitle className="text-base">Medios de pago</CardTitle>
          </CardHeader>
          <CardContent>
            {mediosPago.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay datos en este período.
              </p>
            ) : (
              <GraficoMediosPago data={mediosPago} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  valor,
  destacado = false,
  stagger,
}: {
  icon: React.ReactNode
  label: string
  valor: string
  destacado?: boolean
  stagger?: string
}) {
  return (
    <Card
      className={cn(
        'surface-1 enter-up',
        destacado && 'border-primary/30 bg-primary/5',
        stagger
      )}
    >
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-xl md:text-2xl font-bold font-numeric truncate">
          {valor}
        </p>
      </CardContent>
    </Card>
  )
}
