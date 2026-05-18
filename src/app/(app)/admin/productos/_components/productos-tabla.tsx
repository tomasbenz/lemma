// src/app/(app)/admin/productos/_components/productos-tabla.tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MoreHorizontal, Package } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SortableHeader } from '@/components/app/sortable-header'
import type { ProductoConVariantes } from '@/lib/queries/productos'
import { StockCell, type VarianteStock } from './stock-cell'
import { PrecioCell } from './precio-cell'
import { ActivoToggle } from './activo-toggle'
import { formatARS, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export type Orden =
  | 'nombre_asc'
  | 'nombre_desc'
  | 'stock_asc'
  | 'stock_desc'
  | 'fecha_desc'

type SortColumn = 'nombre' | 'stock'

export function ProductosTabla({
  productos,
  orden,
  onOrdenChange,
  puedeEditar = true,
}: {
  productos: ProductoConVariantes[]
  orden: Orden
  onOrdenChange: (orden: Orden) => void
  puedeEditar?: boolean
}) {
  // Derivar columna y dirección activa desde el prop `orden`.
  // Si el orden no matchea ninguna columna sortable (ej: 'fecha_desc'),
  // sortColumn queda vacío → ningún header se marca como activo.
  const sortColumn: SortColumn | '' = orden.startsWith('nombre')
    ? 'nombre'
    : orden.startsWith('stock')
      ? 'stock'
      : ''
  const sortDir: 'asc' | 'desc' = orden.endsWith('desc') ? 'desc' : 'asc'

  function toggleSort(column: SortColumn | '') {
    // En la práctica el SortableHeader nunca envía '' (cada uso fija un
    // literal). Defensivo por si cambia la inferencia genérica.
    if (column !== 'nombre' && column !== 'stock') return

    if (sortColumn === column) {
      // Misma columna activa → invertir dirección
      onOrdenChange(`${column}_${sortDir === 'asc' ? 'desc' : 'asc'}` as Orden)
    } else {
      // Nueva columna → dirección default:
      //   nombre → asc (A-Z más natural)
      //   stock  → desc (mayor primero, suele ser lo que el usuario quiere)
      const dirDefault = column === 'stock' ? 'desc' : 'asc'
      onOrdenChange(`${column}_${dirDefault}` as Orden)
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <SortableHeader
              column="nombre"
              label="Producto"
              currentColumn={sortColumn}
              currentDir={sortDir}
              onClick={toggleSort}
            />
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            <SortableHeader
              column="stock"
              label="Stock"
              currentColumn={sortColumn}
              currentDir={sortDir}
              onClick={toggleSort}
              align="center"
            />
            <TableHead className="text-center">Variantes</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {productos.map((producto) => {
            const variantesActivas = producto.variantes.filter((v) => v.activa)
            const cantVariantes = variantesActivas.length

            return (
              <TableRow key={producto.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/productos/${producto.id}`}
                    className="flex items-center gap-3 group-hover:text-foreground"
                  >
                    {producto.imagen_url ? (
                      <div className="relative size-9 shrink-0 rounded-md overflow-hidden border bg-muted">
                        <Image
                          src={producto.imagen_url}
                          alt={producto.nombre}
                          fill
                          sizes="36px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Package className="size-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate">{producto.nombre}</div>
                      {producto.categoria && (
                        <div className="text-xs text-muted-foreground truncate">
                          {producto.categoria}
                        </div>
                      )}
                    </div>
                  </Link>
                </TableCell>

                <TableCell>
                  <span className="font-numeric text-xs text-muted-foreground">
                    {producto.sku_base}
                  </span>
                </TableCell>

                <TableCell className="text-right">
                  {puedeEditar ? (
                    <PrecioCell
                      productoId={producto.id}
                      precioInicial={producto.precio_neto}
                    />
                  ) : (
                    <span className="font-numeric tabular-nums">
                      {formatARS(producto.precio_neto)}
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-center">
                  {puedeEditar ? (
                    <StockCell
                      productoId={producto.id}
                      productoNombre={producto.nombre}
                      trackStock={producto.track_stock}
                      variantesActivas={variantesActivas.map<VarianteStock>(
                        (v) => ({
                          id: v.id,
                          color: v.color,
                          talle: v.talle,
                          sku_variante: v.sku_variante,
                          stock: v.stock,
                        })
                      )}
                    />
                  ) : (
                    <StockReadonly
                      trackStock={producto.track_stock}
                      total={producto.stock_total ?? 0}
                      cantVariantes={variantesActivas.length}
                    />
                  )}
                </TableCell>

                <TableCell className="text-center">
                  <Badge variant="outline" className="font-numeric text-xs">
                    {cantVariantes}
                  </Badge>
                </TableCell>

                <TableCell>
                  {puedeEditar ? (
                    <ActivoToggle
                      productoId={producto.id}
                      activoInicial={producto.activo}
                    />
                  ) : producto.activo ? (
                    <Badge variant="outline" className="text-xs">
                      Activo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Inactivo
                    </Badge>
                  )}
                </TableCell>

                <TableCell
                  className="text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                        <span className="sr-only">Abrir menú</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/productos/${producto.id}`}>
                          Ver detalle
                        </Link>
                      </DropdownMenuItem>
                      {puedeEditar && (
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/productos/${producto.id}/editar`}>
                            Editar
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function StockReadonly({
  trackStock,
  total,
  cantVariantes,
}: {
  trackStock: boolean
  total: number
  cantVariantes: number
}) {
  if (!trackStock) {
    return <span className="text-muted-foreground text-sm">—</span>
  }
  const colorClass = cn(
    'font-numeric tabular-nums',
    total === 0 && 'text-destructive font-semibold',
    total > 0 && total <= 5 && 'text-amber-600 font-medium'
  )
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={colorClass}>{formatNumber(total)}</span>
      {cantVariantes > 1 && (
        <span className="text-xs text-muted-foreground">
          ({cantVariantes})
        </span>
      )}
    </span>
  )
}
