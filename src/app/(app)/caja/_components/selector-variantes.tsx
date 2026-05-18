'use client'

import { useMemo, useState, useEffect, useCallback, memo } from 'react'
import { Package, ShoppingCart } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NumericInput } from '@/components/app/numeric-input'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import type { ProductoCaja, VarianteCaja } from '@/lib/queries/productos-caja'

type SelectorVariantesProps = {
  producto: ProductoCaja | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAgregar: (
    producto: ProductoCaja,
    seleccion: Array<{ variante: VarianteCaja; cantidad: number }>
  ) => void
}

type Cantidades = Record<string, number | null>

export function SelectorVariantes({
  producto,
  open,
  onOpenChange,
  onAgregar,
}: SelectorVariantesProps) {
  const [cantidades, setCantidades] = useState<Cantidades>({})

  useEffect(() => {
    if (open && producto) {
      setCantidades({})
    }
  }, [open, producto])

  const { colores, talles, tieneColores, tieneTalles, matriz } = useMemo(() => {
    if (!producto) {
      return {
        colores: [] as string[],
        talles: [] as string[],
        tieneColores: false,
        tieneTalles: false,
        matriz: new Map<string, VarianteCaja>(),
      }
    }

    const colSet = new Set<string>()
    const talSet = new Set<string>()
    const m = new Map<string, VarianteCaja>()

    for (const v of producto.variantes) {
      const c = v.color ?? '—'
      const t = v.talle ?? '—'
      colSet.add(c)
      talSet.add(t)
      m.set(`${c}|${t}`, v)
    }

    const tieneCol = [...colSet].some((c) => c !== '—')
    const tieneTal = [...talSet].some((t) => t !== '—')

    const ordenTalles = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
    const tallesOrdenados = [...talSet].sort((a, b) => {
      const ai = ordenTalles.indexOf(a)
      const bi = ordenTalles.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })

    return {
      colores: [...colSet].sort((a, b) => a.localeCompare(b)),
      talles: tallesOrdenados,
      tieneColores: tieneCol,
      tieneTalles: tieneTal,
      matriz: m,
    }
  }, [producto])

  const { totalUnidades, totalMonto, seleccion, hayInvalidas } = useMemo(() => {
    if (!producto) {
      return {
        totalUnidades: 0,
        totalMonto: 0,
        seleccion: [] as Array<{ variante: VarianteCaja; cantidad: number }>,
        hayInvalidas: false,
      }
    }
    let unidades = 0
    let monto = 0
    let invalidas = false
    const sel: Array<{ variante: VarianteCaja; cantidad: number }> = []

    for (const v of producto.variantes) {
      const cant = cantidades[v.id]
      if (cant === undefined || cant === null) continue
      if (cant < 0) {
        invalidas = true
        continue
      }
      if (producto.track_stock && cant > v.stock) {
        invalidas = true
        continue
      }
      if (cant > 0) {
        unidades += cant
        monto += cant * producto.precio_neto
        sel.push({ variante: v, cantidad: cant })
      }
    }

    return {
      totalUnidades: unidades,
      totalMonto: monto,
      seleccion: sel,
      hayInvalidas: invalidas,
    }
  }, [cantidades, producto])

  const setCantidad = useCallback((varianteId: string, valor: number | null) => {
    setCantidades((prev) => {
      if (prev[varianteId] === valor) return prev
      return { ...prev, [varianteId]: valor }
    })
  }, [])

  if (!producto) return null

  const usarMatriz = tieneColores && tieneTalles

  function handleAgregar() {
    if (hayInvalidas) {
      toast.error('Hay cantidades mayores al stock disponible')
      return
    }
    if (seleccion.length === 0) {
      toast.error('Ingresá al menos una cantidad')
      return
    }
    onAgregar(producto!, seleccion)
    onOpenChange(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !hayInvalidas && seleccion.length > 0) {
      e.preventDefault()
      handleAgregar()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-5xl w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col gap-0 p-0"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <div className="flex items-start gap-3">
            {producto.imagen_url ? (
              <div className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                <Image
                  src={producto.imagen_url}
                  alt={producto.nombre}
                  fill
                  sizes="56px"
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted border">
                <Package className="size-5 text-muted-foreground/60" />
              </div>
            )}
            <div className="flex-1 text-left min-w-0">
              <DialogTitle className="truncate">{producto.nombre}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-1">
                <span className="font-numeric text-xs">
                  {producto.sku_base}
                </span>
                <span>·</span>
                <span className="font-numeric font-medium text-foreground">
                  {formatARS(producto.precio_neto)} c/u
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-4 min-h-0 no-scrollbar">
          <p className="text-xs text-muted-foreground mb-3">
            Ingresá la cantidad a agregar al carrito para cada variante
          </p>

          {usarMatriz ? (
            <MatrizColorTalle
              colores={colores}
              talles={talles}
              matriz={matriz}
              trackStock={producto.track_stock}
              cantidades={cantidades}
              onCantidadChange={setCantidad}
            />
          ) : (
            <ListaVariantes
              variantes={producto.variantes}
              trackStock={producto.track_stock}
              cantidades={cantidades}
              onCantidadChange={setCantidad}
            />
          )}
        </div>

        <div className="border-t p-4 bg-muted/20 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-sm">
            {totalUnidades > 0 ? (
              <div className="space-y-0.5">
                <p>
                  <span className="font-numeric font-semibold">
                    {totalUnidades}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {totalUnidades === 1 ? 'unidad' : 'unidades'}
                  </span>
                </p>
                <p className="font-numeric text-lg font-bold">
                  {formatARS(totalMonto)}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                Ingresá cantidades para ver el total
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleAgregar}
              disabled={seleccion.length === 0 || hayInvalidas}
            >
              <ShoppingCart className="size-4 mr-2" />
              Agregar al carrito
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MatrizColorTalle({
  colores,
  talles,
  matriz,
  trackStock,
  cantidades,
  onCantidadChange,
}: {
  colores: string[]
  talles: string[]
  matriz: Map<string, VarianteCaja>
  trackStock: boolean
  cantidades: Cantidades
  onCantidadChange: (varianteId: string, valor: number | null) => void
}) {
  const gridCols = `minmax(80px, 110px) repeat(${talles.length}, minmax(70px, 1fr))`

  return (
    <div className="w-full overflow-x-auto no-scrollbar pb-1">
      <div
        className="grid gap-y-1"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="py-2 text-left text-xs font-medium text-muted-foreground border-b">
          Color / Talle
        </div>
        {talles.map((t) => (
          <div
            key={`h-${t}`}
            className="py-2 text-center text-xs font-medium border-b"
          >
            {t}
          </div>
        ))}

        {colores.map((c) => (
          <RowColor
            key={c}
            color={c}
            talles={talles}
            matriz={matriz}
            trackStock={trackStock}
            cantidades={cantidades}
            onCantidadChange={onCantidadChange}
          />
        ))}
      </div>
    </div>
  )
}

const RowColor = memo(function RowColor({
  color,
  talles,
  matriz,
  trackStock,
  cantidades,
  onCantidadChange,
}: {
  color: string
  talles: string[]
  matriz: Map<string, VarianteCaja>
  trackStock: boolean
  cantidades: Cantidades
  onCantidadChange: (varianteId: string, valor: number | null) => void
}) {
  return (
    <>
      <div className="py-3 px-1 text-sm font-medium border-b flex items-center">
        {color}
      </div>
      {talles.map((t) => {
        const variante = matriz.get(`${color}|${t}`)
        return (
          <div key={t} className="py-2 border-b flex items-start justify-center">
            {!variante ? (
              <div className="flex h-[56px] items-center justify-center text-muted-foreground/30 text-xs">
                —
              </div>
            ) : (
              <CeldaVarianteMemo
                varianteId={variante.id}
                stock={variante.stock}
                trackStock={trackStock}
                valor={cantidades[variante.id] ?? null}
                onChange={onCantidadChange}
              />
            )}
          </div>
        )
      })}
    </>
  )
})

function ListaVariantes({
  variantes,
  trackStock,
  cantidades,
  onCantidadChange,
}: {
  variantes: VarianteCaja[]
  trackStock: boolean
  cantidades: Cantidades
  onCantidadChange: (varianteId: string, valor: number | null) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {variantes.map((v) => {
        const label = [v.color, v.talle].filter(Boolean).join(' / ') || 'Única'
        return (
          <div
            key={v.id}
            className="p-2 rounded-md border flex flex-col items-stretch gap-1.5"
          >
            <p className="text-sm font-medium text-center">{label}</p>
            <CeldaVarianteMemo
              varianteId={v.id}
              stock={v.stock}
              trackStock={trackStock}
              valor={cantidades[v.id] ?? null}
              onChange={onCantidadChange}
              compacto
            />
          </div>
        )
      })}
    </div>
  )
}

type CeldaProps = {
  varianteId: string
  stock: number
  trackStock: boolean
  valor: number | null
  onChange: (varianteId: string, valor: number | null) => void
  compacto?: boolean
}

const CeldaVarianteMemo = memo(function CeldaVariante({
  varianteId,
  stock,
  trackStock,
  valor,
  onChange,
  compacto = false,
}: CeldaProps) {
  const sinStock = trackStock && stock <= 0
  const excedeStock = valor !== null && trackStock && valor > stock
  const esNegativo = valor !== null && valor < 0
  const invalido = esNegativo || excedeStock

  const handleChange = useCallback(
    (val: number | null) => {
      onChange(varianteId, val)
    },
    [varianteId, onChange]
  )

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 w-full',
        compacto && 'gap-0.5'
      )}
    >
      {!compacto && trackStock && <StockLabel stock={stock} />}
      <NumericInput
        value={valor}
        onChange={handleChange}
        decimals={0}
        min={0}
        max={trackStock ? stock : undefined}
        allowEmpty
        disabled={sinStock}
        placeholder="0"
        className={cn(
          'h-9 text-center text-sm',
          compacto ? 'w-full' : 'w-[80px]',
          invalido && 'border-destructive focus-visible:ring-destructive/50'
        )}
      />
      {compacto && trackStock && !invalido && <StockLabel stock={stock} />}
      {invalido && (
        <span className="text-[10px] text-destructive text-center leading-tight font-medium">
          {excedeStock ? `Máx. ${stock}` : 'Inválido'}
        </span>
      )}
    </div>
  )
})

function StockLabel({ stock }: { stock: number }) {
  const esSinStock = stock === 0
  const esBajo = stock > 0 && stock <= 5

  return (
    <span
      className={cn(
        'text-xs font-numeric font-medium',
        esSinStock && 'text-destructive',
        esBajo && 'text-warning',
        !esSinStock && !esBajo && 'text-foreground/70'
      )}
    >
      {esSinStock ? 'sin stock' : `stock: ${stock}`}
    </span>
  )
}