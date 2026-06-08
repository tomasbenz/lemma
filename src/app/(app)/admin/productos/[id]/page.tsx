import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Pencil, Package } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { obtenerProducto } from '@/lib/queries/productos'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatARS, formatNumber, formatFechaRelativa } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import { CambiarEstadoButton } from './_components/cambiar-estado-button'
import { EliminarProductoButton } from './_components/eliminar-producto-button'
import { AjustarStockDialog } from '../_components/ajustar-stock-dialog'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const producto = await obtenerProducto(id)
  return {
    title: producto ? producto.nombre : 'Producto no encontrado',
  }
}

export default async function ProductoDetallePage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const puedeEditar = puedeEditarCatalogo(user.rol)

  const { id } = await params
  const producto = await obtenerProducto(id)

  if (!producto) {
    notFound()
  }

  const variantesActivas = producto.variantes.filter((v) => v.activa)
  const stockTotal = variantesActivas.reduce(
    (sum, v) => sum + (v.stock ?? 0),
    0
  )
  const hayStockBajo = variantesActivas.some((v) => v.stock < 5)
  const sinStock = stockTotal === 0

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/productos">
              <ArrowLeft className="size-4 mr-1" />
              Volver a productos
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            {/* Imagen o placeholder */}
            {producto.imagen_url ? (
              <div className="relative size-20 md:size-28 shrink-0 rounded-lg overflow-hidden border bg-muted">
                <Image
                  src={producto.imagen_url}
                  alt={producto.nombre}
                  fill
                  sizes="(max-width: 768px) 80px, 112px"
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex size-20 md:size-28 shrink-0 items-center justify-center rounded-lg bg-muted border">
                <Package className="size-8 md:size-10 text-muted-foreground" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight break-words">
                  {producto.nombre}
                </h1>
                {producto.activo ? (
                  <Badge
                    variant="outline"
                    className="text-xs border-success/40 text-success bg-success/10"
                  >
                    <span className="size-1.5 rounded-full bg-success mr-1.5" />
                    Activo
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Inactivo
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 font-numeric">
                {producto.sku_base}
                {(producto.marca_nombre || producto.categoria_nombre) && (
                  <span className="ml-2 text-muted-foreground/70">
                    ·{' '}
                    {[producto.marca_nombre, producto.categoria_nombre]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Creado {formatFechaRelativa(producto.created_at)}
              </p>
            </div>
          </div>

          {puedeEditar && (
            <div className="flex items-center gap-2">
              <CambiarEstadoButton
                productoId={producto.id}
                productoNombre={producto.nombre}
                activo={producto.activo}
              />
              <EliminarProductoButton productoId={producto.id} />
              <Button asChild>
                <Link href={`/admin/productos/${producto.id}/editar`}>
                  <Pencil className="size-4 mr-2" />
                  Editar
                </Link>
              </Button>
            </div>
          )}
        </div>

        {/* Grid: datos generales + stock */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card: datos generales */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Datos generales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataRow label="Precio neto">
                <span className="font-numeric text-lg font-medium">
                  {formatARS(producto.precio_neto)}
                </span>
                <span className="text-xs text-muted-foreground ml-1.5">
                  sin IVA
                </span>
              </DataRow>

              {producto.descripcion_corta && (
                <DataRow label="Descripción">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {producto.descripcion_corta}
                  </p>
                </DataRow>
              )}

              <DataRow label="Control de stock">
                {producto.track_stock ? (
                  <span className="text-sm">
                    Activado — el sistema descuenta stock en cada venta
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground italic">
                    Desactivado — venta ilimitada
                  </span>
                )}
              </DataRow>
            </CardContent>
          </Card>

          {/* Card: stock total */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock total</CardTitle>
            </CardHeader>
            <CardContent>
              {producto.track_stock ? (
                <div>
                  <p
                    className={`text-4xl font-numeric font-bold ${
                      sinStock
                        ? 'text-destructive'
                        : hayStockBajo
                          ? 'text-warning'
                          : ''
                    }`}
                  >
                    {formatNumber(stockTotal)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {variantesActivas.length}{' '}
                    {variantesActivas.length === 1 ? 'variante' : 'variantes'}{' '}
                    activas
                  </p>
                  {hayStockBajo && !sinStock && (
                    <p className="text-xs text-warning mt-2">
                      Algunas variantes tienen stock bajo
                    </p>
                  )}
                  {sinStock && (
                    <p className="text-xs text-destructive mt-2">
                      Sin stock disponible
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No se controla el stock de este producto
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabla de variantes */}
        {producto.track_stock && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Variantes ({producto.variantes.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">
                        Atributos
                      </th>
                      <th className="text-left font-semibold px-4 py-2.5">
                        SKU
                      </th>
                      <th className="text-center font-semibold px-4 py-2.5">
                        Stock
                      </th>
                      <th className="text-left font-semibold px-4 py-2.5">
                        Estado
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {producto.variantes.map((v) => {
                      const atributosLabel = formatAtributos(v.atributos) || '—'
                      return (
                        <tr
                          key={v.id}
                          className={`border-t ${
                            !v.activa ? 'text-muted-foreground' : ''
                          }`}
                        >
                          <td className="px-4 py-2.5">{atributosLabel}</td>
                          <td className="px-4 py-2.5 font-numeric text-xs">
                            {v.sku_variante}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span
                              className={`font-numeric ${
                                v.activa && v.stock === 0
                                  ? 'text-destructive font-medium'
                                  : v.activa && v.stock < 5
                                    ? 'text-warning font-medium'
                                    : ''
                              }`}
                            >
                              {formatNumber(v.stock)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {v.activa ? (
                              <Badge
                                variant="outline"
                                className="text-xs border-success/30 text-success bg-success/10"
                              >
                                Activa
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Inactiva
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {v.activa && (
                              <AjustarStockDialog
                                varianteId={v.id}
                                stockActual={v.stock}
                                productoNombre={producto.nombre}
                                varianteLabel={
                                  atributosLabel !== '—'
                                    ? atributosLabel
                                    : v.sku_variante || 'Única'
                                }
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function DataRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div>{children}</div>
    </div>
  )
}