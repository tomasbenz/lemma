'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MoreHorizontal, Package } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatARS, formatNumber } from '@/lib/format'
import type { ProductoConVariantes } from '@/lib/queries/productos'

export function ProductosCards({
  productos,
  puedeEditar = true,
}: {
  productos: ProductoConVariantes[]
  puedeEditar?: boolean
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {productos.map((producto) => (
        <ProductoCard
          key={producto.id}
          producto={producto}
          puedeEditar={puedeEditar}
        />
      ))}
    </div>
  )
}

function ProductoCard({
  producto,
  puedeEditar,
}: {
  producto: ProductoConVariantes
  puedeEditar: boolean
}) {
  const variantesActivas = producto.variantes.filter((v) => v.activa)
  const hayStockBajo = variantesActivas.some((v) => v.stock < 5)
  const sinStock = producto.stock_total === 0

  return (
    <Card className="group relative overflow-hidden transition-colors hover:border-foreground/20">
      {/* Menú de acciones flotante en esquina */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 bg-background/80 backdrop-blur"
            >
              <MoreHorizontal className="size-4" />
              <span className="sr-only">Abrir menú</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/productos/${producto.id}`}>Ver detalle</Link>
            </DropdownMenuItem>
            {puedeEditar && (
              <>
                <DropdownMenuItem asChild>
                  <Link href={`/admin/productos/${producto.id}/editar`}>
                    Editar
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled
                >
                  {producto.activo ? 'Desactivar' : 'Reactivar'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/admin/productos/${producto.id}`} className="block">
        {/* Imagen o placeholder full-width */}
        {producto.imagen_url ? (
          <div className="relative aspect-[4/3] w-full bg-muted border-b">
            <Image
              src={producto.imagen_url}
              alt={producto.nombre}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted border-b">
            <Package className="size-12 text-muted-foreground/50" />
          </div>
        )}

        <CardContent className="p-4 space-y-3">
          {/* Header: nombre + SKU */}
          <div className="min-w-0">
            <h3 className="font-medium truncate">{producto.nombre}</h3>
            <p className="text-xs text-muted-foreground font-numeric truncate">
              {producto.sku_base}
            </p>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            <div>
              <p className="text-xs text-muted-foreground">Precio</p>
              <p className="font-numeric font-medium">
                {formatARS(producto.precio_neto)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stock</p>
              {producto.track_stock ? (
                <p
                  className={
                    sinStock
                      ? 'text-destructive font-numeric font-medium'
                      : hayStockBajo
                        ? 'text-warning font-numeric font-medium'
                        : 'font-numeric font-medium'
                  }
                >
                  {formatNumber(producto.stock_total)}
                  {hayStockBajo && !sinStock && (
                    <span className="text-[10px] ml-1 text-warning">bajo</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  sin track
                </p>
              )}
            </div>
          </div>

          {/* Footer: variantes + estado */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="font-numeric text-xs">
                {variantesActivas.length}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {variantesActivas.length === 1 ? 'variante' : 'variantes'}
              </span>
            </div>
            {producto.activo ? (
              <Badge
                variant="outline"
                className="text-xs border-success/40 text-success bg-success/10"
              >
                <span className="size-1.5 rounded-full bg-success mr-1" />
                Activo
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Inactivo
              </Badge>
            )}
          </div>
        </CardContent>
      </Link>
    </Card>
  )
}