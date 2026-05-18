// src/app/(app)/admin/clientes/_components/clientes-view.tsx
'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDebouncedCallback } from 'use-debounce'
import { Search, Users, Mail, Phone, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/app/empty-state'
import { SortableHeader, type SortDir } from '@/components/app/sortable-header'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  labelCondIva,
  type CondIva,
  type ClienteConStats,
} from '@/lib/queries/clientes-types'
import type { ListarClientesOptions } from '@/lib/queries/clientes-types'

type Props = {
  clientes: ClienteConStats[]
  total: number
  filters: ListarClientesOptions
}

type SortColumn =
  | 'razon_social'
  | 'cuit'
  | 'cond_iva'
  | 'cantidad_ventas'
  | 'monto_total_vendido'
  | 'estado'

export function ClientesView({ clientes, total, filters }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busquedaLocal, setBusquedaLocal] = useState(filters.q ?? '')

  const [sortColumn, setSortColumn] = useState<SortColumn>('razon_social')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const actualizar = (patch: Partial<ListarClientesOptions>) => {
    const url = new URL(window.location.href)

    if ('q' in patch) {
      if (patch.q) url.searchParams.set('q', patch.q)
      else url.searchParams.delete('q')
    }
    if ('soloActivos' in patch) {
      if (patch.soloActivos === false) {
        url.searchParams.set('estado', 'todos')
      } else {
        url.searchParams.delete('estado')
      }
    }

    startTransition(() => {
      router.replace(`${url.pathname}${url.search}`, { scroll: false })
    })
  }

  const actualizarBusquedaDebounced = useDebouncedCallback((valor: string) => {
    actualizar({ q: valor || undefined })
  }, 300)

  const onChangeBusqueda = (valor: string) => {
    setBusquedaLocal(valor)
    actualizarBusquedaDebounced(valor)
  }

  const limpiarFiltros = () => {
    setBusquedaLocal('')
    startTransition(() => {
      router.replace('/admin/clientes', { scroll: false })
    })
  }

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      const numerica = ['cantidad_ventas', 'monto_total_vendido'].includes(
        column
      )
      setSortDir(numerica ? 'desc' : 'asc')
    }
  }

  const clientesOrdenados = useMemo(() => {
    const copia = [...clientes]
    copia.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'razon_social':
          cmp = a.razon_social.localeCompare(b.razon_social)
          break
        case 'cuit':
          cmp = (a.cuit ?? '').localeCompare(b.cuit ?? '')
          break
        case 'cond_iva':
          cmp = a.cond_iva.localeCompare(b.cond_iva)
          break
        case 'cantidad_ventas':
          cmp = a.cantidad_ventas - b.cantidad_ventas
          break
        case 'monto_total_vendido':
          cmp = a.monto_total_vendido - b.monto_total_vendido
          break
        case 'estado':
          cmp = Number(b.activo) - Number(a.activo)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copia
  }, [clientes, sortColumn, sortDir])

  const hayFiltros = !!filters.q || filters.soloActivos === false

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 enter-fade">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, CUIT o email..."
            value={busquedaLocal}
            onChange={(e) => onChangeBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Estado:</span>
          <Select
            value={filters.soloActivos === false ? 'todos' : 'activos'}
            onValueChange={(v) => actualizar({ soloActivos: v === 'activos' })}
          >
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hayFiltros && (
          <Button
            variant="ghost"
            size="sm"
            onClick={limpiarFiltros}
            className="h-9 text-muted-foreground"
          >
            <X className="size-3.5 mr-1" />
            Limpiar
          </Button>
        )}

        <p className="text-xs text-muted-foreground ml-auto hidden md:block">
          Click en cualquier columna para ordenar
        </p>
      </div>

      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {clientes.length === total
            ? `${total} ${total === 1 ? 'cliente' : 'clientes'}`
            : `Mostrando ${clientes.length} de ${total} clientes`}
        </p>
      )}

      {/* Tabla */}
      {clientes.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon={<Users />}
            title="No se encontraron clientes"
            description="Probá cambiar los filtros o limpiar la búsqueda."
            action={
              <Button variant="outline" onClick={limpiarFiltros}>
                <X className="size-4 mr-1.5" />
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title="Todavía no hay clientes cargados"
            description="Agregá clientes para poder emitir facturas A y llevar seguimiento."
            action={
              <Button asChild>
                <Link href="/admin/clientes/nuevo">Crear primer cliente</Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="rounded-lg border overflow-hidden surface-1 enter-up">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableHeader
                  column="razon_social"
                  label="Razón social"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
                <SortableHeader
                  column="cuit"
                  label="CUIT"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
                <SortableHeader
                  column="cond_iva"
                  label="Cond. IVA"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
                <SortableHeader
                  column="razon_social"
                  label="Contacto"
                  currentColumn={'__none' as SortColumn}
                  currentDir={sortDir}
                  onClick={() => {}}
                />
                <SortableHeader
                  column="cantidad_ventas"
                  label="Ventas"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  align="right"
                />
                <SortableHeader
                  column="monto_total_vendido"
                  label="Total facturado"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                  align="right"
                />
                <SortableHeader
                  column="estado"
                  label="Estado"
                  currentColumn={sortColumn}
                  currentDir={sortDir}
                  onClick={toggleSort}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientesOrdenados.map((c) => (
                <ClienteRow key={c.id} cliente={c} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ============ Sub-componentes ============

function ClienteRow({ cliente }: { cliente: ClienteConStats }) {
  return (
    <TableRow className="group relative cursor-pointer transition-colors duration-200 hover:bg-muted/40">
      <TableCell className="relative">
        <Link
          href={`/admin/clientes/${cliente.id}`}
          className="absolute inset-0 z-10"
          prefetch
        >
          <span className="sr-only">Ver {cliente.razon_social}</span>
        </Link>
        <span className="font-medium relative transition-colors duration-200 group-hover:text-primary">
          {cliente.razon_social}
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground font-numeric">
        {cliente.cuit ?? '—'}
      </TableCell>
      <TableCell>
        <BadgeCondIva cond={cliente.cond_iva} />
      </TableCell>
      <TableCell className="text-xs">
        <div className="space-y-0.5">
          {cliente.email && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Mail className="size-3" />
              <span className="truncate max-w-[200px]">{cliente.email}</span>
            </div>
          )}
          {cliente.telefono && (
            <div className="flex items-center gap-1 text-muted-foreground font-numeric">
              <Phone className="size-3" />
              <span>{cliente.telefono}</span>
            </div>
          )}
          {!cliente.email && !cliente.telefono && (
            <span className="text-muted-foreground/60">—</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-numeric text-sm">
        {cliente.cantidad_ventas > 0 ? (
          cliente.cantidad_ventas
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </TableCell>
      <TableCell className="text-right font-numeric text-sm">
        {cliente.monto_total_vendido > 0 ? (
          formatARS(cliente.monto_total_vendido)
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </TableCell>
      <TableCell>
        {cliente.activo ? (
          <Badge
            variant="outline"
            className="text-xs text-success bg-success/10 border-success/40"
          >
            <span className="size-1.5 rounded-full bg-success mr-1.5" />
            Activo
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Inactivo
          </Badge>
        )}
      </TableCell>
    </TableRow>
  )
}

function BadgeCondIva({ cond }: { cond: CondIva }) {
  const color = {
    RI: 'text-primary border-primary/40 bg-primary/10',
    MONO: 'text-foreground border-foreground/30 bg-muted',
    CF: 'text-muted-foreground',
    EX: 'text-warning border-warning/40 bg-warning/10',
  }[cond]

  return (
    <Badge variant="outline" className={cn('text-xs', color)}>
      {labelCondIva(cond)}
    </Badge>
  )
}