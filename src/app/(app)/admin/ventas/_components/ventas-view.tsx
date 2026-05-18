// src/app/(app)/admin/ventas/_components/ventas-view.tsx
'use client'

import { useState, useTransition, useMemo, useDeferredValue } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search,
  Calendar,
  TrendingUp,
  ShoppingBag,
  Package,
  FileText,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/app/empty-state'
import { SortableHeader, type SortDir } from '@/components/app/sortable-header'
import { BadgeEstado } from '@/components/app/badge-estado'
import { BadgeFactura } from '@/components/app/badge-factura'
import { FechaCorta } from '@/components/app/fecha-corta'
import {
  ClienteCombobox,
  type ClienteOption,
} from '@/components/app/cliente-combobox'
import { ExportarVentasButton } from './exportar-ventas-button'
import {
  PRESET_LIST,
  type PresetFecha,
  detectarPreset,
  calcularRango,
} from '@/lib/utils/date-presets'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VentaListado, ListarVentasOptions } from '@/lib/queries/ventas'

type VentasViewProps = {
  ventas: VentaListado[]
  total: number
  totales: {
    cantidad: number
    montoTotal: number
    unidadesVendidas: number
  }
  filters: ListarVentasOptions
  clienteFiltrado: { id: string; razon_social: string } | null
  clientesParaCombobox: ClienteOption[]
}

type SortColumn =
  | 'numero'
  | 'fecha'
  | 'vendedor'
  | 'cliente'
  | 'items'
  | 'total'
  | 'factura'
  | 'estado'

/**
 * Devuelve el nombre a mostrar para el cliente de una venta.
 * Prioriza `nombre_cliente_custom` (alias) > `cliente.razon_social` (cliente real)
 * > "Consumidor final" como fallback.
 */
function nombreClienteParaMostrar(venta: VentaListado): string {
  if (venta.nombre_cliente_custom) return venta.nombre_cliente_custom
  if (venta.cliente?.razon_social) return venta.cliente.razon_social
  return ''
}

export function VentasView({
  ventas,
  total,
  totales,
  filters,
  clienteFiltrado,
  clientesParaCombobox,
}: VentasViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [busqueda, setBusqueda] = useState(filters.busqueda ?? '')
  const busquedaDiferida = useDeferredValue(busqueda)

  const [sortColumn, setSortColumn] = useState<SortColumn>('fecha')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const presetInicial = detectarPreset(filters.desde, filters.hasta)
  const [preset, setPreset] = useState<PresetFecha>(presetInicial)
  const [desdeCustom, setDesdeCustom] = useState(
    filters.desde?.slice(0, 10) ?? ''
  )
  const [hastaCustom, setHastaCustom] = useState(
    filters.hasta?.slice(0, 10) ?? ''
  )

  function navegarConFiltros(patch: Partial<ListarVentasOptions>) {
    const merged: Record<string, string> = {}

    if (filters.desde) merged.desde = filters.desde
    if (filters.hasta) merged.hasta = filters.hasta
    if (filters.estado) merged.estado = filters.estado
    if (filters.tipoFactura) merged.tipoFactura = filters.tipoFactura
    if (filters.clienteId) merged.clienteId = filters.clienteId

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === null) {
        delete merged[key]
      } else {
        merged[key] = String(value)
      }
    }

    const query = new URLSearchParams(merged).toString()
    startTransition(() => {
      router.replace(`/admin/ventas${query ? `?${query}` : ''}`, {
        scroll: false,
      })
    })
  }

  function aplicarPreset(nuevo: PresetFecha) {
    setPreset(nuevo)
    const { desde, hasta } = calcularRango(nuevo)
    if (nuevo === 'custom') return
    navegarConFiltros({
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
  }

  function aplicarCustom() {
    const desde = desdeCustom ? `${desdeCustom}T00:00:00` : undefined
    const hasta = hastaCustom ? `${hastaCustom}T23:59:59` : undefined
    navegarConFiltros({ desde, hasta })
  }

  function limpiarFiltros() {
    setBusqueda('')
    startTransition(() => {
      router.replace('/admin/ventas', { scroll: false })
    })
  }

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      const numerica = ['numero', 'fecha', 'total', 'items'].includes(column)
      setSortDir(numerica ? 'desc' : 'asc')
    }
  }

  const ventasFiltradas = useMemo(() => {
    const q = busquedaDiferida.trim().toLowerCase().replace(/^#/, '')
    let lista = ventas

    if (q) {
      lista = ventas.filter((v) => {
        if (String(v.numero).includes(q)) return true
        const vendedor = (
          v.usuario?.nombre_completo ??
          v.usuario?.email ??
          ''
        ).toLowerCase()
        if (vendedor.includes(q)) return true
        // Buscar en cliente real Y en nombre custom
        const cliente = (v.cliente?.razon_social ?? '').toLowerCase()
        if (cliente.includes(q)) return true
        const nombreCustom = (v.nombre_cliente_custom ?? '').toLowerCase()
        if (nombreCustom.includes(q)) return true
        const cuit = (
          (v.cliente as { cuit?: string | null } | null)?.cuit ?? ''
        ).toLowerCase()
        if (cuit.includes(q)) return true
        const montoStr = v.total.toFixed(0)
        if (montoStr.includes(q.replace(/[.,]/g, ''))) return true
        if (v.tipo_factura.replace('_', ' ').toLowerCase().includes(q))
          return true
        return false
      })
    }

    const copia = [...lista]
    copia.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'numero':
          cmp = a.numero - b.numero
          break
        case 'fecha':
          cmp =
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
          break
        case 'vendedor': {
          const va = a.usuario?.nombre_completo ?? a.usuario?.email ?? ''
          const vb = b.usuario?.nombre_completo ?? b.usuario?.email ?? ''
          cmp = va.localeCompare(vb)
          break
        }
        case 'cliente': {
          // Sort prioriza nombre custom para consistencia con lo que se muestra
          const ca = nombreClienteParaMostrar(a)
          const cb = nombreClienteParaMostrar(b)
          cmp = ca.localeCompare(cb)
          break
        }
        case 'items':
          cmp = a.items_cantidad_total - b.items_cantidad_total
          break
        case 'total':
          cmp = a.total - b.total
          break
        case 'factura':
          cmp = a.tipo_factura.localeCompare(b.tipo_factura)
          break
        case 'estado':
          cmp = a.estado.localeCompare(b.estado)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copia
  }, [ventas, busquedaDiferida, sortColumn, sortDir])

  // IDs de las ventas que están viendo (después de filtros + búsqueda).
  // Lo pasamos al export para que respete TODO lo que el usuario tiene aplicado.
  const ventasIdsFiltradas = useMemo(
    () => ventasFiltradas.map((v) => v.id),
    [ventasFiltradas]
  )

  const hayFiltrosActivos = useMemo(() => {
    return !!(
      filters.desde ||
      filters.hasta ||
      filters.estado ||
      filters.tipoFactura ||
      filters.clienteId ||
      busqueda.trim()
    )
  }, [filters, busqueda])

  const filtroEnProceso = busqueda !== busquedaDiferida

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricaCard
          icon={<ShoppingBag className="size-4 text-muted-foreground" />}
          label="Ventas"
          valor={total.toLocaleString('es-AR')}
          stagger="stagger-1"
        />
        <MetricaCard
          icon={<TrendingUp className="size-4 text-muted-foreground" />}
          label="Monto total"
          valor={formatARS(totales.montoTotal)}
          stagger="stagger-2"
        />
        <MetricaCard
          icon={<Package className="size-4 text-muted-foreground" />}
          label="Unidades"
          valor={totales.unidadesVendidas.toLocaleString('es-AR')}
          stagger="stagger-3"
        />
      </div>

      {clienteFiltrado && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-primary/30 bg-primary/5 enter-fade">
          <span className="text-xs text-muted-foreground">
            Filtrado por cliente:
          </span>
          <Link
            href={`/admin/clientes/${clienteFiltrado.id}`}
            className="text-sm font-medium hover:underline underline-offset-2"
          >
            {clienteFiltrado.razon_social}
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navegarConFiltros({ clienteId: undefined })}
            className="h-6 ml-auto text-muted-foreground"
          >
            <X className="size-3.5 mr-1" />
            Quitar filtro
          </Button>
        </div>
      )}

      <Card className="enter-up">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <Calendar className="size-4" />
              <span>Período:</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESET_LIST.map(({ key, label }) => (
                <Button
                  key={key}
                  variant={preset === key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => aplicarPreset(key)}
                  className="h-8"
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex-1 min-w-[200px] max-w-xs">
              <div className="relative">
                <Search
                  className={cn(
                    'absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 transition-colors duration-200',
                    busqueda ? 'text-foreground' : 'text-muted-foreground'
                  )}
                />
                <Input
                  placeholder="Buscar por N°, vendedor, cliente, monto..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className={cn(
                    'pl-8 pr-8 h-8 transition-opacity',
                    filtroEnProceso && 'opacity-70'
                  )}
                />
                {busqueda && (
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title="Limpiar búsqueda"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {busqueda && (
              <span className="text-xs text-muted-foreground font-numeric tabular-nums">
                {ventasFiltradas.length}{' '}
                {ventasFiltradas.length === 1 ? 'resultado' : 'resultados'}
              </span>
            )}

            {hayFiltrosActivos && (
              <Button
                variant="ghost"
                size="sm"
                onClick={limpiarFiltros}
                className="h-8 text-muted-foreground"
              >
                <X className="size-3.5 mr-1" />
                Limpiar
              </Button>
            )}
          </div>

          {preset === 'custom' && (
            <div className="flex flex-wrap items-end gap-2 pt-2 border-t enter-fade">
              <div>
                <label className="text-xs text-muted-foreground">Desde</label>
                <Input
                  type="date"
                  value={desdeCustom}
                  onChange={(e) => setDesdeCustom(e.target.value)}
                  className="h-8 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hasta</label>
                <Input
                  type="date"
                  value={hastaCustom}
                  onChange={(e) => setHastaCustom(e.target.value)}
                  className="h-8 mt-1"
                />
              </div>
              <Button size="sm" onClick={aplicarCustom} className="h-8">
                Aplicar
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t items-center">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Estado:</span>
              <Select
                value={filters.estado ?? 'todos'}
                onValueChange={(v) =>
                  navegarConFiltros({
                    estado:
                      v === 'todos'
                        ? undefined
                        : (v as ListarVentasOptions['estado']),
                  })
                }
              >
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="cerrada">Cerrada</SelectItem>
                  <SelectItem value="anulada">Anulada</SelectItem>
                  <SelectItem value="abierta">Abierta</SelectItem>
                  <SelectItem value="guardada">Guardada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Factura:</span>
              <Select
                value={filters.tipoFactura ?? 'todos'}
                onValueChange={(v) =>
                  navegarConFiltros({
                    tipoFactura:
                      v === 'todos'
                        ? undefined
                        : (v as ListarVentasOptions['tipoFactura']),
                  })
                }
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="sin_factura">Sin factura</SelectItem>
                  <SelectItem value="factura_a">Factura A</SelectItem>
                  <SelectItem value="factura_b">Factura B</SelectItem>
                  {/* Backcompat: ventas historicas de homologacion */}
                  <SelectItem value="factura_c">Factura C</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Cliente:</span>
              <ClienteCombobox
                clientes={clientesParaCombobox}
                value={filters.clienteId ?? null}
                onChange={(id) =>
                  navegarConFiltros({ clienteId: id ?? undefined })
                }
                placeholder="Todos"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <ExportarVentasButton
                ventasIds={ventasIdsFiltradas}
                disabled={ventasFiltradas.length === 0}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground -mt-1">
            Click en cualquier columna para ordenar
          </p>
        </CardContent>
      </Card>

      {ventasFiltradas.length === 0 ? (
        hayFiltrosActivos ? (
          <EmptyState
            icon={<FileText />}
            title="No se encontraron ventas"
            description={
              busqueda
                ? `No hay coincidencias para "${busqueda}". Probá con otro término.`
                : 'Probá cambiar los filtros o ampliar el rango de fechas.'
            }
            action={
              <Button variant="outline" onClick={limpiarFiltros}>
                <X className="size-4 mr-1.5" />
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileText />}
            title="Todavía no hay ventas registradas"
            description="Cuando cierres una venta desde la caja, vas a verla listada acá."
            action={
              <Button asChild>
                <Link href="/caja">Ir a la caja</Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="rounded-lg border overflow-hidden enter-up stagger-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableHeader
                  column="numero"
                  label="N°"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  className="w-20"
                />
                <SortableHeader
                  column="fecha"
                  label="Fecha"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  className="w-36"
                />
                <SortableHeader
                  column="vendedor"
                  label="Vendedor"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
                <SortableHeader
                  column="cliente"
                  label="Cliente"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
                <SortableHeader
                  column="items"
                  label="Items"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  align="center"
                  className="w-20"
                />
                <SortableHeader
                  column="total"
                  label="Total"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  align="right"
                  className="w-32"
                />
                <SortableHeader
                  column="factura"
                  label="Factura"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  className="w-28"
                />
                <SortableHeader
                  column="estado"
                  label="Estado"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  className="w-28"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ventasFiltradas.map((v) => (
                <VentaRow key={v.id} venta={v} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ============ Sub-componentes ============

function MetricaCard({
  icon,
  label,
  valor,
  stagger,
}: {
  icon: React.ReactNode
  label: string
  valor: string
  stagger?: string
}) {
  return (
    <Card className={cn('enter-up', stagger)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1.5">
          {icon}
          <span>{label}</span>
        </div>
        <p className="text-2xl font-bold font-numeric">{valor}</p>
      </CardContent>
    </Card>
  )
}

function VentaRow({ venta }: { venta: VentaListado }) {
  // Determinar qué mostrar y si poner badge "alias"
  const tieneCustom = !!venta.nombre_cliente_custom
  const tieneClienteReal = !!venta.cliente?.razon_social
  const nombreMostrado = venta.nombre_cliente_custom ?? venta.cliente?.razon_social ?? null

  return (
    <TableRow className="group relative cursor-pointer transition-colors duration-200 hover:bg-muted/40 [&_a.row-link]:absolute [&_a.row-link]:inset-0 [&_a.row-link]:z-[1]">
      <TableCell>
        <Link href={`/admin/ventas/${venta.id}`} className="row-link" prefetch>
          <span className="sr-only">Ver venta #{venta.numero}</span>
        </Link>
        <span className="font-numeric font-bold text-base relative transition-colors duration-200 group-hover:text-primary">
          #{venta.numero}
        </span>
      </TableCell>
      <TableCell className="text-sm">
        <FechaCorta fecha={venta.created_at} />
      </TableCell>
      <TableCell className="text-sm">
        {venta.usuario?.nombre_completo ?? venta.usuario?.email ?? '—'}
      </TableCell>
      <TableCell className="text-sm">
        {nombreMostrado ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn('truncate', tieneCustom && 'font-medium')}>
              {nombreMostrado}
            </span>
            {tieneCustom && tieneClienteReal && (
              <Badge
                variant="outline"
                className="text-[9px] py-0 px-1.5 h-4 shrink-0 font-normal text-muted-foreground"
                title={`Cliente real: ${venta.cliente?.razon_social}`}
              >
                alias
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground italic">Consumidor final</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="font-numeric text-xs">
          {venta.items_cantidad_total}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-numeric font-semibold">
        {formatARS(venta.total)}
      </TableCell>
      <TableCell>
        <BadgeFactura tipo={venta.tipo_factura} />
      </TableCell>
      <TableCell>
        <BadgeEstado estado={venta.estado} contexto="venta" />
      </TableCell>
    </TableRow>
  )
}