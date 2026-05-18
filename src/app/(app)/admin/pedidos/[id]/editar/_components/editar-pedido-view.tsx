// src/app/(app)/admin/pedidos/[id]/editar/_components/editar-pedido-view.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Search, Package, Trash2, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/app/numeric-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import { SelectorVariantes } from '@/app/(app)/caja/_components/selector-variantes'
import type {
  ProductoCaja,
  VarianteCaja,
} from '@/lib/queries/productos-caja'

import {
  editarPedido,
  type EditarPedidoItem,
} from '../../../_actions/editar-pedido'

type ItemPedidoRaw = {
  id: string
  variante_id: string
  producto_nombre: string
  producto_sku: string
  variante_sku: string
  variante_color: string | null
  variante_talle: string | null
  cantidad: number
  precio_unitario_neto: number
  subtotal_neto: number
}

type EditarItemLocal = {
  varianteId: string
  productoNombre: string
  productoSku: string
  varianteSku: string
  varianteColor: string | null
  varianteTalle: string | null
  cantidad: number
  precioUnitarioNeto: number
}

type Props = {
  pedidoId: string
  pedidoNumero: number
  itemsIniciales: ItemPedidoRaw[]
  productos: ProductoCaja[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function itemsKey(items: EditarItemLocal[]): string {
  // Deep-compare friendly: orden estable + tupla (varianteId, cantidad, precio).
  // Si cambia cualquiera de los tres -> "hay cambios".
  return [...items]
    .sort((a, b) => a.varianteId.localeCompare(b.varianteId))
    .map((i) => `${i.varianteId}:${i.cantidad}:${i.precioUnitarioNeto}`)
    .join('|')
}

function mapRawToLocal(raw: ItemPedidoRaw): EditarItemLocal {
  return {
    varianteId: raw.variante_id,
    productoNombre: raw.producto_nombre,
    productoSku: raw.producto_sku,
    varianteSku: raw.variante_sku,
    varianteColor: raw.variante_color,
    varianteTalle: raw.variante_talle,
    cantidad: raw.cantidad,
    precioUnitarioNeto: raw.precio_unitario_neto,
  }
}

export function EditarPedidoView({
  pedidoId,
  pedidoNumero,
  itemsIniciales,
  productos,
}: Props) {
  const router = useRouter()

  const itemsInicialesLocales = useMemo(
    () => itemsIniciales.map(mapRawToLocal),
    [itemsIniciales]
  )

  const keyInicial = useMemo(
    () => itemsKey(itemsInicialesLocales),
    [itemsInicialesLocales]
  )

  const [items, setItems] = useState<EditarItemLocal[]>(itemsInicialesLocales)
  const [busqueda, setBusqueda] = useState('')
  const [productoSelector, setProductoSelector] =
    useState<ProductoCaja | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos
    return productos.filter((p) => {
      return (
        p.nombre.toLowerCase().includes(q) ||
        p.sku_base.toLowerCase().includes(q) ||
        p.categoria?.toLowerCase().includes(q)
      )
    })
  }, [productos, busqueda])

  // Index para mirar precio_neto del producto al agregar variantes
  const productosPorVariante = useMemo(() => {
    const m = new Map<string, { producto: ProductoCaja; variante: VarianteCaja }>()
    for (const p of productos) {
      for (const v of p.variantes) {
        m.set(v.id, { producto: p, variante: v })
      }
    }
    return m
  }, [productos])

  const subtotal = useMemo(
    () =>
      items.reduce(
        (acc, i) => acc + round2(i.cantidad * i.precioUnitarioNeto),
        0
      ),
    [items]
  )

  const hayCambios = useMemo(
    () => itemsKey(items) !== keyInicial,
    [items, keyInicial]
  )

  const agregarVariante = useCallback(
    (producto: ProductoCaja, variante: VarianteCaja, cantidad: number) => {
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.varianteId === variante.id)
        if (idx >= 0) {
          // Si ya existe, sumar cantidad (no reemplazar)
          const copia = [...prev]
          copia[idx] = {
            ...copia[idx],
            cantidad: copia[idx].cantidad + cantidad,
          }
          return copia
        }
        return [
          ...prev,
          {
            varianteId: variante.id,
            productoNombre: producto.nombre,
            productoSku: producto.sku_base,
            varianteSku: variante.sku_variante,
            varianteColor: variante.color,
            varianteTalle: variante.talle,
            cantidad,
            precioUnitarioNeto: producto.precio_neto,
          },
        ]
      })
    },
    []
  )

  const handleProductoClick = useCallback(
    (producto: ProductoCaja) => {
      if (producto.variantes.length === 0) {
        toast.error('Este producto no tiene variantes activas')
        return
      }
      if (producto.variantes.length === 1) {
        const v = producto.variantes[0]
        agregarVariante(producto, v, 1)
        const label = [v.color, v.talle].filter(Boolean).join(' / ')
        toast.success(
          label ? `${producto.nombre} — ${label}` : producto.nombre,
          { duration: 1500 }
        )
        return
      }
      setProductoSelector(producto)
    },
    [agregarVariante]
  )

  const handleSeleccionMultiple = useCallback(
    (
      producto: ProductoCaja,
      seleccion: Array<{ variante: VarianteCaja; cantidad: number }>
    ) => {
      for (const { variante, cantidad } of seleccion) {
        agregarVariante(producto, variante, cantidad)
      }
      const total = seleccion.reduce((acc, s) => acc + s.cantidad, 0)
      toast.success(
        `${producto.nombre} · ${total} ${
          total === 1 ? 'unidad agregada' : 'unidades agregadas'
        }`,
        { duration: 1500 }
      )
    },
    [agregarVariante]
  )

  const setCantidad = useCallback(
    (varianteId: string, cantidad: number | null) => {
      if (cantidad === null || cantidad <= 0) return
      setItems((prev) =>
        prev.map((i) => (i.varianteId === varianteId ? { ...i, cantidad } : i))
      )
    },
    []
  )

  const eliminarItem = useCallback((varianteId: string) => {
    setItems((prev) => prev.filter((i) => i.varianteId !== varianteId))
  }, [])

  async function handleGuardar() {
    if (items.length === 0) {
      toast.error('El pedido debe tener al menos un item')
      return
    }
    if (!hayCambios) {
      toast.error('No hay cambios para guardar')
      return
    }

    setSubmitting(true)

    const payload: EditarPedidoItem[] = items.map((i) => ({
      varianteId: i.varianteId,
      productoNombre: i.productoNombre,
      productoSku: i.productoSku,
      varianteSku: i.varianteSku,
      varianteColor: i.varianteColor,
      varianteTalle: i.varianteTalle,
      cantidad: i.cantidad,
      precioUnitarioNeto: i.precioUnitarioNeto,
    }))

    const result = await editarPedido({
      pedidoId,
      items: payload,
    })

    setSubmitting(false)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    toast.success(`Pedido #${pedidoNumero} actualizado`)
    router.push(`/admin/pedidos/${pedidoId}`)
    router.refresh()
  }

  return (
    <div className="flex-1 p-3 md:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={`/admin/pedidos/${pedidoId}`}>
              <ArrowLeft className="size-4 mr-1" />
              Volver al pedido
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-numeric">
            Editar pedido #{pedidoNumero}
          </h1>
          <Button variant="outline" asChild>
            <Link href={`/admin/pedidos/${pedidoId}`}>Cancelar</Link>
          </Button>
        </div>

        {/* Grid principal */}
        <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-[1fr_400px] items-start">
          {/* IZQUIERDA: catálogo */}
          <Card className="surface-1 enter-up min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agregar productos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar producto por nombre, SKU o categoría..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>

              <div className="max-h-[60vh] overflow-y-auto no-scrollbar pr-1">
                {productosFiltrados.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {busqueda
                      ? 'No se encontraron productos'
                      : 'No hay productos cargados'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {productosFiltrados.map((producto) => (
                      <ProductoTile
                        key={producto.id}
                        producto={producto}
                        onClick={() => handleProductoClick(producto)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* DERECHA: items del pedido */}
          <Card className="surface-1 enter-up min-w-0 lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Items del pedido</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {items.length} {items.length === 1 ? 'producto' : 'productos'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-[55vh] overflow-y-auto no-scrollbar pr-1 space-y-2">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    El pedido está vacío. Agregá productos desde la izquierda.
                  </p>
                ) : (
                  items.map((item) => {
                    const detalleVariante = [item.varianteColor, item.varianteTalle]
                      .filter(Boolean)
                      .join(' / ')
                    const subtotalItem = round2(
                      item.cantidad * item.precioUnitarioNeto
                    )
                    const info = productosPorVariante.get(item.varianteId)
                    const sinStockInfo = !info
                    return (
                      <div
                        key={item.varianteId}
                        className="rounded-md border p-2.5 space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.productoNombre}
                            </p>
                            <p className="text-xs text-muted-foreground font-numeric truncate">
                              {detalleVariante || 'Única'} ·{' '}
                              {item.varianteSku}
                            </p>
                            {sinStockInfo && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Variante no está en el catálogo activo
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => eliminarItem(item.varianteId)}
                            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            aria-label="Eliminar item"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              Cant.
                            </span>
                            <NumericInput
                              value={item.cantidad}
                              onChange={(v) => setCantidad(item.varianteId, v)}
                              decimals={0}
                              min={1}
                              className="h-8 w-20 text-center text-sm font-numeric"
                            />
                          </div>
                          <p className="font-numeric font-semibold text-sm">
                            {formatARS(subtotalItem)}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Subtotal
                  </span>
                  <span className="font-numeric text-lg font-bold">
                    {formatARS(subtotal)}
                  </span>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  disabled={
                    submitting || items.length === 0 || !hayCambios
                  }
                  onClick={handleGuardar}
                >
                  {submitting ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <SelectorVariantes
        producto={productoSelector}
        open={productoSelector !== null}
        onOpenChange={(o) => {
          if (!o) setProductoSelector(null)
        }}
        onAgregar={handleSeleccionMultiple}
      />
    </div>
  )
}

function ProductoTile({
  producto,
  onClick,
}: {
  producto: ProductoCaja
  onClick: () => void
}) {
  const sinVariantes = producto.variantes.length === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sinVariantes}
      className={cn(
        'group flex flex-col items-stretch overflow-hidden rounded-md border bg-card text-left',
        'transition hover:border-foreground/40 hover:shadow-sm',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <div className="relative aspect-square bg-muted">
        {producto.imagen_url ? (
          <Image
            src={producto.imagen_url}
            alt={producto.nombre}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="size-6 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-medium truncate">{producto.nombre}</p>
        <p className="text-[10px] text-muted-foreground font-numeric truncate">
          {producto.sku_base}
        </p>
        <p className="text-xs font-numeric font-semibold">
          {formatARS(producto.precio_neto)}
        </p>
      </div>
    </button>
  )
}
