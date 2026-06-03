// src/app/(app)/admin/pedidos/_components/pedidos-view.tsx
'use client'

import { useState, useMemo, useTransition, useDeferredValue } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search,
  Inbox,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/app/empty-state'
import { FechaRelativa } from '@/components/app/fecha-relativa'
import { BadgeEstado } from '@/components/app/badge-estado'
import { formatARS } from '@/lib/format'
import { coincide } from '@/lib/search/fuzzy'
import { cn } from '@/lib/utils'
import type { PedidoRow, FiltrosPedidos } from '@/lib/queries/pedidos'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'
import { BulkActionsBar } from './bulk-actions-bar'
import { BulkAnularDialog } from './bulk-anular-dialog'
import { BulkClienteDialog } from './bulk-cliente-dialog'

type Vendedor = {
  id: string
  nombre_completo: string | null
  email: string
}

type SortColumn =
  | 'numero'
  | 'fecha'
  | 'vendedor'
  | 'cliente'
  | 'items'
  | 'total'
  | 'estado'
type SortDir = 'asc' | 'desc'

type PedidosViewProps = {
  pedidos: PedidoRow[]
  vendedores: Vendedor[]
  alcance: FiltrosPedidos['alcance']
  clientes: ClienteCaja[]
  /**
   * Si false, oculta el dropdown "Mostrar" y el filtro por vendedor
   * (la vendedora solo ve sus propios pendientes).
   */
  puedeVerCerradas?: boolean
}

const ALCANCE_LABEL: Record<NonNullable<FiltrosPedidos['alcance']>, string> = {
  pendientes: 'Solo pendientes',
  pendientes_y_recientes: 'Pendientes + última semana',
  todos: 'Todos',
}

export function PedidosView({
  pedidos,
  vendedores,
  alcance,
  clientes,
  puedeVerCerradas = true,
}: PedidosViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busqueda, setBusqueda] = useState('')
  const busquedaDiferida = useDeferredValue(busqueda)
  const filtroEnProceso = busqueda !== busquedaDiferida
  const [sortColumn, setSortColumn] = useState<SortColumn>('fecha')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [anularOpen, setAnularOpen] = useState(false)
  const [clienteOpen, setClienteOpen] = useState(false)

  function actualizarUrl(patch: { alcance?: string; vendedor?: string }) {
    const url = new URL(window.location.href)
    if ('alcance' in patch) {
      if (patch.alcance && patch.alcance !== 'pendientes_y_recientes') {
        url.searchParams.set('alcance', patch.alcance)
      } else {
        url.searchParams.delete('alcance')
      }
    }
    if ('vendedor' in patch) {
      if (patch.vendedor && patch.vendedor !== 'todos') {
        url.searchParams.set('vendedor', patch.vendedor)
      } else {
        url.searchParams.delete('vendedor')
      }
    }
    startTransition(() => {
      router.replace(`${url.pathname}${url.search}`, { scroll: false })
    })
  }

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDir(column === 'fecha' || column === 'total' ? 'desc' : 'asc')
    }
  }

  const conteos = useMemo(() => {
    return {
      pendientes: pedidos.filter((p) => p.estado === 'guardada').length,
      cerradas: pedidos.filter((p) => p.estado === 'cerrada').length,
      anuladas: pedidos.filter((p) => p.estado === 'anulada').length,
      total: pedidos.length,
    }
  }, [pedidos])

  const pedidosFiltrados = useMemo(() => {
    const q = busquedaDiferida.trim().toLowerCase().replace(/^#/, '')
    let lista = pedidos

    if (q) {
      lista = lista.filter((p) => {
        // Match exacto por número (igual que antes; fuzzy acá sería peligroso)
        if (String(p.numero).includes(q)) return true

        // Fuzzy (tildes, typos, espacios) sobre los campos de texto.
        // coincide() filtra sin reordenar → no pisa el sort por columna.
        const texto = [
          p.vendedor?.nombre_completo,
          p.vendedor?.email,
          p.cliente?.razon_social,
          p.cliente?.cuit,
          p.nombre_cliente_custom,
          p.nota_interna,
        ]
          .filter(Boolean)
          .join(' ')

        return coincide(q, texto)
      })
    }

    // Sort
    const ordenada = [...lista].sort((a, b) => {
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
          const va = a.vendedor?.nombre_completo ?? a.vendedor?.email ?? ''
          const vb = b.vendedor?.nombre_completo ?? b.vendedor?.email ?? ''
          cmp = va.localeCompare(vb)
          break
        }
        case 'cliente': {
          const ca = a.nombre_cliente_custom ?? a.cliente?.razon_social ?? ''
          const cb = b.nombre_cliente_custom ?? b.cliente?.razon_social ?? ''
          cmp = ca.localeCompare(cb)
          break
        }
        case 'items':
          cmp = a.items_count - b.items_count
          break
        case 'total':
          cmp = a.subtotal_neto - b.subtotal_neto
          break
        case 'estado':
          cmp = a.estado.localeCompare(b.estado)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return ordenada
  }, [pedidos, busquedaDiferida, sortColumn, sortDir])

  const seleccionablesIds = useMemo(
    () =>
      pedidosFiltrados
        .filter((p) => p.estado === 'guardada')
        .map((p) => p.id),
    [pedidosFiltrados],
  )

  const todosSeleccionados =
    seleccionablesIds.length > 0 &&
    seleccionablesIds.every((id) => seleccionados.has(id))

  const algunosSeleccionados =
    seleccionablesIds.some((id) => seleccionados.has(id)) && !todosSeleccionados

  const toggleSeleccionado = (id: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTodos = () => {
    if (todosSeleccionados) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(seleccionablesIds))
    }
  }

  const limpiarSeleccion = () => setSeleccionados(new Set())

  return (
    <div
      className={cn(
        'flex-1 p-4 md:p-6 lg:p-8 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Pedidos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-numeric font-medium text-foreground">
                {conteos.pendientes}
              </span>{' '}
              {conteos.pendientes === 1 ? 'pendiente' : 'pendientes'}
              {conteos.cerradas > 0 && (
                <>
                  {' · '}
                  <span className="font-numeric font-medium text-foreground">
                    {conteos.cerradas}
                  </span>{' '}
                  {conteos.cerradas === 1 ? 'cerrada' : 'cerradas'}
                </>
              )}
              {conteos.anuladas > 0 && (
                <>
                  {' · '}
                  <span className="font-numeric font-medium text-foreground">
                    {conteos.anuladas}
                  </span>{' '}
                  {conteos.anuladas === 1 ? 'anulada' : 'anuladas'}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap items-stretch sm:items-center">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              className={cn(
                'absolute left-3 top-1/2 size-4 -translate-y-1/2 transition-colors duration-200',
                busqueda ? 'text-foreground' : 'text-muted-foreground'
              )}
            />
            <Input
              placeholder="Buscar por #número, vendedora, cliente, nota..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className={cn(
                'pl-9 pr-9 h-10 transition-opacity',
                filtroEnProceso && 'opacity-70'
              )}
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                title="Limpiar búsqueda"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {puedeVerCerradas && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Mostrar:
              </span>
              <Select
                value={alcance ?? 'pendientes_y_recientes'}
                onValueChange={(v) => actualizarUrl({ alcance: v })}
              >
                <SelectTrigger className="h-10 w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendientes">
                    {ALCANCE_LABEL.pendientes}
                  </SelectItem>
                  <SelectItem value="pendientes_y_recientes">
                    {ALCANCE_LABEL.pendientes_y_recientes}
                  </SelectItem>
                  <SelectItem value="todos">{ALCANCE_LABEL.todos}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {puedeVerCerradas && vendedores.length > 1 && (
            <Select
              defaultValue="todos"
              onValueChange={(v) => actualizarUrl({ vendedor: v })}
            >
              <SelectTrigger className="h-10 w-full sm:w-56">
                <SelectValue placeholder="Todos los vendedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los vendedores</SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nombre_completo ?? v.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {busqueda && (
            <span className="text-xs text-muted-foreground font-numeric tabular-nums self-center">
              {pedidosFiltrados.length}{' '}
              {pedidosFiltrados.length === 1 ? 'resultado' : 'resultados'}
            </span>
          )}
        </div>

        {/* Tabla */}
        {pedidosFiltrados.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={
              pedidos.length === 0
                ? 'No hay pedidos para mostrar'
                : 'Sin resultados'
            }
            description={
              pedidos.length === 0
                ? 'Cuando las vendedoras guarden pedidos, los vas a ver acá.'
                : 'Probá con otros filtros o términos de búsqueda.'
            }
          />
        ) : (
          <div className="rounded-lg border overflow-hidden enter-up">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-10">
                    {seleccionablesIds.length > 0 && (
                      <Checkbox
                        checked={
                          algunosSeleccionados ? 'indeterminate' : todosSeleccionados
                        }
                        onCheckedChange={toggleTodos}
                        aria-label="Seleccionar todos los pendientes"
                      />
                    )}
                  </TableHead>
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
                    className="w-32"
                  />
                  <SortableHeader
                    column="vendedor"
                    label="Vendedora"
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
                    className="text-center w-20"
                  />
                  <SortableHeader
                    column="total"
                    label="Total"
                    currentColumn={sortColumn}
                    currentDir={sortDir}
                    onClick={toggleSort}
                    className="text-right w-32"
                  />
                  <SortableHeader
                    column="estado"
                    label="Estado"
                    currentColumn={sortColumn}
                    currentDir={sortDir}
                    onClick={toggleSort}
                    className="w-32"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidosFiltrados.map((p) => (
                  <PedidoRow
                    key={p.id}
                    pedido={p}
                    seleccionado={seleccionados.has(p.id)}
                    onToggleSeleccion={() => toggleSeleccionado(p.id)}
                    seleccionable={p.estado === 'guardada'}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <BulkActionsBar
        seleccionados={seleccionados.size}
        onLimpiar={limpiarSeleccion}
        onAnular={() => setAnularOpen(true)}
        onAsignarCliente={() => setClienteOpen(true)}
      />

      <BulkAnularDialog
        open={anularOpen}
        onOpenChange={setAnularOpen}
        pedidoIds={Array.from(seleccionados)}
        onSuccess={limpiarSeleccion}
      />

      <BulkClienteDialog
        open={clienteOpen}
        onOpenChange={setClienteOpen}
        pedidoIds={Array.from(seleccionados)}
        clientes={clientes}
        onSuccess={limpiarSeleccion}
      />
    </div>
  )
}

// ============ Sub-componentes ============

function SortableHeader({
  column,
  label,
  currentColumn,
  currentDir,
  onClick,
  className,
}: {
  column: SortColumn
  label: string
  currentColumn: SortColumn
  currentDir: SortDir
  onClick: (col: SortColumn) => void
  className?: string
}) {
  const active = currentColumn === column

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onClick(column)}
        className={cn(
          'flex items-center gap-1 transition-colors duration-200 hover:text-foreground',
          active ? 'text-foreground font-semibold' : 'text-muted-foreground',
          className?.includes('text-right') && 'ml-auto',
          className?.includes('text-center') && 'mx-auto'
        )}
      >
        {label}
        {active ? (
          currentDir === 'asc' ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

function PedidoRow({
  pedido,
  seleccionado,
  onToggleSeleccion,
  seleccionable,
}: {
  pedido: PedidoRow
  seleccionado: boolean
  onToggleSeleccion: () => void
  seleccionable: boolean
}) {
  // Bajo el modelo nuevo, el subtotal_neto YA es lo que va a pagar el cliente
  // (el recargo opcional 10,5% se decide al finalizar el pedido).
  const totalEstimado = pedido.estado === 'cerrada' ? pedido.total : pedido.subtotal_neto
  const esNuevo = pedido.estado === 'guardada' && pedido.vista_at === null

  // Pendientes  detalle de pedido (finalizar/anular)
  // Cerradas/anuladas  detalle de venta (historial, factura)
  const href =
    pedido.estado === 'guardada'
      ? `/admin/pedidos/${pedido.id}`
      : `/admin/ventas/${pedido.id}`

  return (
    <TableRow className="group relative cursor-pointer transition-colors duration-200 hover:bg-muted/40 [&_a.row-link]:absolute [&_a.row-link]:inset-0 [&_a.row-link]:z-[1]">
      <TableCell
        className="w-10 relative z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {seleccionable && (
          <Checkbox
            checked={seleccionado}
            onCheckedChange={onToggleSeleccion}
            aria-label={`Seleccionar pedido #${pedido.numero}`}
          />
        )}
      </TableCell>
      <TableCell>
        <Link
          href={href}
          className="row-link"
          prefetch
        >
          <span className="sr-only">Ver pedido #{pedido.numero}</span>
        </Link>
        <div className="flex items-center gap-1.5 relative">
          {esNuevo && (
            <span
              className="size-1.5 rounded-full bg-warning shrink-0 animate-pulse"
              title="Sin ver"
            />
          )}
          <span className="font-numeric font-bold text-base transition-colors duration-200 group-hover:text-primary">
            #{pedido.numero}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        <FechaRelativa
          fecha={pedido.created_at}
          variante="larga"
          className="font-numeric"
        />
      </TableCell>
      <TableCell className="text-sm">
        {pedido.vendedor?.nombre_completo ?? pedido.vendedor?.email ?? '—'}
      </TableCell>
      <TableCell className="text-sm">
        {pedido.nombre_cliente_custom ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium truncate">
              {pedido.nombre_cliente_custom}
            </span>
            {pedido.cliente?.razon_social && (
              <Badge
                variant="outline"
                className="text-[9px] py-0 px-1.5 h-4 shrink-0 font-normal text-muted-foreground"
                title={`Cliente real: ${pedido.cliente.razon_social}`}
              >
                alias
              </Badge>
            )}
          </div>
        ) : pedido.cliente?.razon_social ? (
          pedido.cliente.razon_social
        ) : (
          <span className="text-muted-foreground italic">Sin cliente</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="font-numeric text-xs">
          {pedido.items_count}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-numeric font-semibold">
        {formatARS(totalEstimado)}
      </TableCell>
      <TableCell>
        <BadgeEstado estado={pedido.estado} contexto="pedido" />
      </TableCell>
    </TableRow>
  )
}