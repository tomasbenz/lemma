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
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatARS, formatNumber } from '@/lib/format'
import type {
  PeriodoReporte,
  KpisReporte,
  VentaPorDia,
  ProductoTop,
  MedioPagoAgregado,
} from '@/lib/queries/reportes'
import { exportarReporteExcel } from '../_actions/exportar-reporte-excel'
import { GraficoVentas } from './grafico-ventas'
import { GraficoMediosPago } from './grafico-medios-pago'

type Props = {
  periodo: PeriodoReporte
  kpis: KpisReporte
  ventasPorDia: VentaPorDia[]
  topProductos: ProductoTop[]
  mediosPago: MedioPagoAgregado[]
}

const PERIODOS_LABEL: Record<PeriodoReporte, string> = {
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  mes_actual: 'Mes actual',
  anio_actual: 'Año actual',
}

export function ReportesView({
  periodo,
  kpis,
  ventasPorDia,
  topProductos,
  mediosPago,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [exportando, startExportando] = useTransition()

  function cambiarPeriodo(nuevo: PeriodoReporte) {
    startTransition(() => {
      router.replace(`/admin/reportes?periodo=${nuevo}`, { scroll: false })
    })
  }

  function descargarPdf() {
    window.open(`/api/reportes/pdf?periodo=${periodo}`, '_blank')
  }

  function descargarPdfImprimible() {
    window.open(
      `/api/reportes/pdf?periodo=${periodo}&modo=light`,
      '_blank'
    )
  }

  function descargarExcel() {
    startExportando(async () => {
      const result = await exportarReporteExcel(periodo)
      if (!result.ok) {
        toast.error(result.error)
        return
      }

      const byteChars = atob(result.base64)
      const byteNumbers = new Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('Excel descargado')
    })
  }

  return (
    <div
      className={cn(
        'space-y-6 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      {/* Selector de período + exportar */}
      <div className="flex flex-wrap items-center gap-1.5 enter-fade">
        {(Object.keys(PERIODOS_LABEL) as PeriodoReporte[]).map((p) => (
          <Button
            key={p}
            variant={p === periodo ? 'default' : 'outline'}
            size="sm"
            onClick={() => cambiarPeriodo(p)}
          >
            {PERIODOS_LABEL[p]}
          </Button>
        ))}

        <div className="flex-1" />

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
            <DropdownMenuItem onClick={descargarPdf}>
              <FileText className="size-4 mr-2" />
              Descargar PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={descargarPdfImprimible}>
              <Printer className="size-4 mr-2" />
              Versión para imprimir
            </DropdownMenuItem>
            <DropdownMenuItem onClick={descargarExcel} disabled={exportando}>
              <FileSpreadsheet className="size-4 mr-2" />
              Exportar Excel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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