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
import { StockBadge, bandaStockClase } from './stock-badge'
import { PrecioCell } from './precio-cell'
import { ActivoToggle } from './activo-toggle'
import { FilaCheckbox } from './fila-checkbox'
import { SeleccionHeaderCheckbox } from './seleccion-header-checkbox'
import { formatARS } from '@/lib/format'
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
  densidad = 'normal',
  recienId,
  puedeEditar = true,
}: {
  productos: ProductoConVariantes[]
  orden: Orden
  onOrdenChange: (orden: Orden) => void
  densidad?: 'normal' | 'compacta'
  recienId?: string
  puedeEditar?: boolean
}) {
  // Densidad: compacta reduce padding de celda + tamaño de imagen para mostrar
  // más filas por pantalla. Normal es el default.
  const celdaPad = densidad === 'compacta' ? 'py-1.5 px-3' : 'py-3 px-4'
  const imgBox = densidad === 'compacta' ? 'size-9' : 'size-12'
  const imgIcon = densidad === 'compacta' ? 'size-4' : 'size-5'
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

  const paginaIds = productos.map((p) => p.id)

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {/* Banda de stock (priority lane) */}
            <TableHead className="w-1 p-0" />
            {puedeEditar && (
              <TableHead className="w-10">
                <SeleccionHeaderCheckbox paginaIds={paginaIds} />
              </TableHead>
            )}
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

            // Banda de stock + tinte tenue de fila para "sin stock".
            const banda = bandaStockClase(
              producto.stock_total ?? 0,
              producto.track_stock
            )
            const filaTinte = banda === 'bg-destructive' ? 'bg-destructive/5' : ''

            // Producto "incompleto": le faltan 2+ de foto / marca / categoría.
            const faltantes: string[] = []
            if (!producto.imagen_url) faltantes.push('foto')
            if (!producto.marca_id) faltantes.push('marca')
            if (!producto.categoria_id) faltantes.push('categoría')
            const incompleto = faltantes.length >= 2

            return (
              <TableRow
                key={producto.id}
                className={cn(
                  'group hover:bg-muted/30',
                  filaTinte,
                  recienId === producto.id && 'animate-pulse-once'
                )}
              >
                {/* Banda de stock (priority lane) al borde izquierdo */}
                <TableCell className={cn('w-1 p-0', banda)} />
                {puedeEditar && (
                  <TableCell className={cn('w-10', celdaPad)}>
                    <FilaCheckbox id={producto.id} />
                  </TableCell>
                )}
                <TableCell className={cn('font-medium', celdaPad)}>
                  <Link
                    href={`/admin/productos/${producto.id}`}
                    className="flex items-center gap-3 group-hover:text-foreground"
                  >
                    {producto.imagen_url ? (
                      <div
                        className={cn(
                          'relative shrink-0 rounded-md overflow-hidden border bg-muted',
                          imgBox
                        )}
                      >
                        <Image
                          src={producto.imagen_url}
                          alt={producto.nombre}
                          fill
                          sizes="48px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'flex shrink-0 items-center justify-center rounded-md bg-muted',
                          imgBox
                        )}
                      >
                        <Package className={cn('text-muted-foreground', imgIcon)} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">
                        {producto.nombre}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {producto.marca_nombre ? (
                          <Badge variant="secondary" className="text-xs">
                            {producto.marca_nombre}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-dashed text-muted-foreground shrink-0"
                          >
                            Sin marca
                          </Badge>
                        )}
                        {producto.categoria_nombre ? (
                          <span className="text-xs text-muted-foreground truncate">
                            {producto.categoria_nombre}
                          </span>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-dashed text-muted-foreground shrink-0"
                          >
                            Sin categoría
                          </Badge>
                        )}
                        {incompleto && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-warning/40 bg-warning/10 text-warning shrink-0"
                            title={`Faltan: ${faltantes.join(', ')}`}
                          >
                            Incompleto
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                </TableCell>

                <TableCell className={celdaPad}>
                  <span className="font-numeric text-xs text-muted-foreground">
                    {producto.sku_base}
                  </span>
                </TableCell>

                <TableCell className={cn('text-right', celdaPad)}>
                  {puedeEditar ? (
                    <PrecioCell
                      productoId={producto.id}
                      precioInicial={producto.precio_neto}
                      displayClassName="font-bold text-base"
                    />
                  ) : (
                    <span className="font-numeric font-bold text-base tabular-nums">
                      {formatARS(producto.precio_neto)}
                    </span>
                  )}
                </TableCell>

                <TableCell className={cn('text-center', celdaPad)}>
                  {puedeEditar ? (
                    <StockCell
                      productoId={producto.id}
                      productoNombre={producto.nombre}
                      trackStock={producto.track_stock}
                      variantesActivas={variantesActivas.map<VarianteStock>(
                        (v) => ({
                          id: v.id,
                          atributos:
                            v.atributos &&
                            typeof v.atributos === 'object' &&
                            !Array.isArray(v.atributos)
                              ? (v.atributos as Record<string, string>)
                              : {},
                          sku_variante: v.sku_variante,
                          stock: v.stock,
                        })
                      )}
                    />
                  ) : (
                    <StockBadge
                      stock={producto.stock_total ?? 0}
                      trackStock={producto.track_stock}
                    />
                  )}
                </TableCell>

                <TableCell className={cn('text-center', celdaPad)}>
                  <Badge variant="outline" className="font-numeric text-xs">
                    {cantVariantes}
                  </Badge>
                </TableCell>

                <TableCell className={celdaPad}>
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
                  className={cn('text-right', celdaPad)}
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
