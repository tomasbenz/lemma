// src/app/(app)/admin/ventas/[id]/editar/_components/editar-venta-view.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  Search,
  Package,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/app/numeric-input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import { SelectorVariantes } from '@/app/(app)/caja/_components/selector-variantes'
import type {
  ProductoCaja,
  VarianteCaja,
} from '@/lib/queries/productos-caja'

import {
  editarVenta,
  type EditarVentaItem,
} from '../../../_actions/editar-venta'

type ItemVentaRaw = {
  id: string
  variante_id: string
  producto_nombre: string
  producto_sku: string
  variante_sku: string
  // Supabase devuelve jsonb como Json (record/array/string/etc). Coercemos
  // en mapRawToLocal al shape Record<string,string> que renderiza la UI.
  variante_atributos: unknown
  cantidad: number
  precio_unitario_neto: number
  subtotal_neto: number
}

type FacturaAprobada = {
  id: string
  numero_comprobante: number | null
  punto_venta: number
  cae: string | null
  tipo_factura: string
}

type EditarItemLocal = {
  varianteId: string
  productoNombre: string
  productoSku: string
  varianteSku: string
  varianteAtributos: Record<string, string>
  cantidad: number
  precioUnitarioNeto: number
}

type Props = {
  ventaId: string
  ventaNumero: number
  ventaTotal: number
  itemsIniciales: ItemVentaRaw[]
  facturaAprobada: FacturaAprobada | null
  productos: ProductoCaja[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function itemsKey(items: EditarItemLocal[]): string {
  return [...items]
    .sort((a, b) => a.varianteId.localeCompare(b.varianteId))
    .map((i) => `${i.varianteId}:${i.cantidad}:${i.precioUnitarioNeto}`)
    .join('|')
}

function coerceAtributos(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== null && v !== undefined) out[k] = String(v)
  }
  return out
}

function mapRawToLocal(raw: ItemVentaRaw): EditarItemLocal {
  return {
    varianteId: raw.variante_id,
    productoNombre: raw.producto_nombre,
    productoSku: raw.producto_sku,
    varianteSku: raw.variante_sku,
    varianteAtributos: coerceAtributos(raw.variante_atributos),
    cantidad: raw.cantidad,
    precioUnitarioNeto: raw.precio_unitario_neto,
  }
}

function labelTipoFactura(tipo: string): string {
  switch (tipo) {
    case 'factura_a':
      return 'Factura A'
    case 'factura_b':
      return 'Factura B'
    case 'factura_c':
      return 'Factura B'
    default:
      return tipo
  }
}

function formatComprobante(
  puntoVenta: number,
  numeroComprobante: number | null
): string {
  const pv = puntoVenta.toString().padStart(4, '0')
  const nc =
    numeroComprobante !== null
      ? numeroComprobante.toString().padStart(8, '0')
      : '----'
  return `${pv}-${nc}`
}

export function EditarVentaView({
  ventaId,
  ventaNumero,
  ventaTotal,
  itemsIniciales,
  facturaAprobada,
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
  const [confirmOpen, setConfirmOpen] = useState(false)

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

  const productosPorVariante = useMemo(() => {
    const m = new Map<
      string,
      { producto: ProductoCaja; variante: VarianteCaja }
    >()
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
            varianteAtributos: variante.atributos,
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
        const label = formatAtributos(v.atributos)
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

  async function ejecutarGuardado() {
    setSubmitting(true)

    const payload: EditarVentaItem[] = items.map((i) => ({
      varianteId: i.varianteId,
      productoNombre: i.productoNombre,
      productoSku: i.productoSku,
      varianteSku: i.varianteSku,
      varianteAtributos: i.varianteAtributos,
      cantidad: i.cantidad,
      precioUnitarioNeto: i.precioUnitarioNeto,
    }))

    const result = await editarVenta({
      ventaId,
      items: payload,
    })

    setSubmitting(false)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    toast.success(`Venta #${ventaNumero} actualizada`)
    if (result.stockAjustesCount > 0) {
      toast.info(
        `Stock ajustado en ${result.stockAjustesCount} ${
          result.stockAjustesCount === 1 ? 'variante' : 'variantes'
        }`,
        { duration: 3000 }
      )
    }
    router.push(`/admin/ventas/${ventaId}`)
    router.refresh()
  }

  function handleGuardarClick() {
    if (items.length === 0) {
      toast.error('La venta debe tener al menos un item')
      return
    }
    if (!hayCambios) {
      toast.error('No hay cambios para guardar')
      return
    }

    if (facturaAprobada) {
      setConfirmOpen(true)
      return
    }
    ejecutarGuardado()
  }

  return (
    <div className="flex-1 p-3 md:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={`/admin/ventas/${ventaId}`}>
              <ArrowLeft className="size-4 mr-1" />
              Volver a la venta
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-numeric">
            Editar venta #{ventaNumero}
          </h1>
          <Button variant="outline" asChild>
            <Link href={`/admin/ventas/${ventaId}`}>Cancelar</Link>
          </Button>
        </div>

        {/* Grid principal */}
        <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-[1fr_400px] items-start">
          {/* IZQUIERDA: catalogo */}
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

          {/* DERECHA: panel */}
          <div className="space-y-4 lg:sticky lg:top-4">
            {/* Warning si tiene factura */}
            {facturaAprobada && (
              <Card className="border-warning/40 bg-warning/5 enter-up min-w-0">
                <CardContent className="p-3 flex items-start gap-2">
                  <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1 min-w-0">
                    <p className="font-medium text-warning">
                      Esta venta tiene factura emitida:{' '}
                      {labelTipoFactura(facturaAprobada.tipo_factura)}{' '}
                      {formatComprobante(
                        facturaAprobada.punto_venta,
                        facturaAprobada.numero_comprobante
                      )}
                      {facturaAprobada.cae && (
                        <> (CAE {facturaAprobada.cae})</>
                      )}
                      .
                    </p>
                    <p className="text-muted-foreground">
                      Vas a modificar items y total. La factura AFIP queda
                      intacta (es un documento fiscal inmutable). Para
                      corrección fiscal, emití una nota de crédito.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="surface-1 enter-up min-w-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Items de la venta</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {items.length}{' '}
                    {items.length === 1 ? 'producto' : 'productos'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-[55vh] overflow-y-auto no-scrollbar pr-1 space-y-2">
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      La venta está vacía. Agregá productos desde la izquierda.
                    </p>
                  ) : (
                    items.map((item) => {
                      const detalleVariante = formatAtributos(
                        item.varianteAtributos
                      )
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
                                onChange={(v) =>
                                  setCantidad(item.varianteId, v)
                                }
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
                    disabled={submitting || items.length === 0 || !hayCambios}
                    onClick={handleGuardarClick}
                  >
                    {submitting ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
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

      {/* Confirmacion si venta tiene factura */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirmar edición de venta facturada
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta venta tiene factura AFIP por {formatARS(ventaTotal)}. La
              factura no se modifica. Solo se actualizará la venta y el stock.
              ¿Confirmás?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                setConfirmOpen(false)
                ejecutarGuardado()
              }}
            >
              Entiendo, editar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
