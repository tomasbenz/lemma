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
import { formatARS } from '@/lib/format'
import { StockBadge } from './stock-badge'
import { cn } from '@/lib/utils'
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
  return (
    <Card
      className={cn(
        'group relative overflow-hidden transition-all hover:border-foreground/20 hover:shadow-elev-2',
        !producto.activo && 'opacity-60'
      )}
    >
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
        {/* Imagen cuadrada o placeholder */}
        {producto.imagen_url ? (
          <div className="relative aspect-square w-full bg-muted border-b">
            <Image
              src={producto.imagen_url}
              alt={producto.nombre}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
              unoptimized
            />
            {!producto.activo && (
              <Badge
                variant="outline"
                className="absolute left-2 top-2 bg-background/80 backdrop-blur text-xs"
              >
                Inactivo
              </Badge>
            )}
          </div>
        ) : (
          <div className="relative flex aspect-square w-full items-center justify-center bg-muted border-b">
            <Package className="size-12 text-muted-foreground/50" />
            {!producto.activo && (
              <Badge
                variant="outline"
                className="absolute left-2 top-2 bg-background/80 backdrop-blur text-xs"
              >
                Inactivo
              </Badge>
            )}
          </div>
        )}

        <CardContent className="p-3 space-y-2">
          {/* Nombre + marca + categoría */}
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold leading-tight line-clamp-2">
              {producto.nombre}
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {producto.marca_nombre && (
                <span className="text-xs text-muted-foreground truncate">
                  {producto.marca_nombre}
                </span>
              )}
              {!producto.categoria_id && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-dashed text-muted-foreground"
                >
                  Sin categoría
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-numeric truncate">
              {producto.sku_base}
            </p>
          </div>

          {/* Stock + precio */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <StockBadge
              stock={producto.stock_total ?? 0}
              trackStock={producto.track_stock}
            />
            <span className="font-numeric text-lg font-bold">
              {formatARS(producto.precio_neto)}
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  )
}