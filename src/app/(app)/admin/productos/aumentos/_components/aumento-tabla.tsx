'use client'

import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ProductoEnAumento } from '../_actions/buscar-productos'

export function AumentoTabla({
  productos,
  total,
  totalFiltroCompleto,
  seleccionados,
  onToggle,
  onTogglePagina,
  page,
  pageSize,
  onPageChange,
  cargando,
  hayFiltroPrincipal,
  onSeleccionarTodoFiltro,
  seleccionExcedeCap,
}: {
  productos: ProductoEnAumento[]
  total: number
  totalFiltroCompleto: number
  seleccionados: Set<string>
  onToggle: (id: string) => void
  onTogglePagina: (ids: string[], seleccionar: boolean) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  cargando: boolean
  hayFiltroPrincipal: boolean
  onSeleccionarTodoFiltro: () => void
  seleccionExcedeCap: boolean
}) {
  const paginaIds = productos.map((p) => p.id)
  const seleccionadosEnPagina = paginaIds.filter((id) => seleccionados.has(id)).length
  const estadoPagina =
    seleccionadosEnPagina === 0
      ? 'vacio'
      : seleccionadosEnPagina === paginaIds.length
        ? 'todos'
        : 'parcial'

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize))
  // Hay más productos en el filtro que los visibles en esta página.
  const hayMas = totalFiltroCompleto > productos.length

  if (!hayFiltroPrincipal) {
    return (
      <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
        Cargá al menos un filtro (marca o categoría) para empezar.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Banner "seleccionar todos del filtro" */}
      {hayMas && estadoPagina === 'todos' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Seleccionaste los {productos.length} de esta página. Hay{' '}
            {totalFiltroCompleto}
            {seleccionExcedeCap ? '+' : ''} en el filtro.
          </span>
          <Button variant="outline" size="sm" onClick={onSeleccionarTodoFiltro}>
            Seleccionar todos ({totalFiltroCompleto})
          </Button>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="relative max-h-[58vh] overflow-y-auto no-scrollbar">
          {cargando && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <Table>
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Seleccionar página"
                    checked={
                      estadoPagina === 'todos'
                        ? true
                        : estadoPagina === 'parcial'
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={(v) => onTogglePagina(paginaIds, v === true)}
                    disabled={productos.length === 0}
                  />
                </TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right w-20">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-sm text-muted-foreground"
                  >
                    Sin productos en este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                productos.map((p) => {
                  const sel = seleccionados.has(p.id)
                  return (
                    <TableRow
                      key={p.id}
                      data-state={sel ? 'selected' : undefined}
                      className={cn('cursor-pointer', !p.activo && 'opacity-60')}
                      onClick={() => onToggle(p.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Seleccionar ${p.nombre}`}
                          checked={sel}
                          onCheckedChange={() => onToggle(p.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span className="truncate">{p.nombre}</span>
                          {p.sku_base && (
                            <span className="text-[11px] text-muted-foreground font-numeric">
                              {p.sku_base}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.marca_nombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.categoria_nombre ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-numeric tabular-nums">
                        {formatARS(p.precio_neto)}
                      </TableCell>
                      <TableCell className="text-right font-numeric tabular-nums text-muted-foreground">
                        {p.stock_total}
                        {!p.activo && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            inactivo
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Paginador */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground font-numeric tabular-nums">
            {total} {total === 1 ? 'producto' : 'productos'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || cargando}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground font-numeric tabular-nums">
              {page} / {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPaginas || cargando}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
