// src/app/(app)/caja/_components/carrito-panel.tsx
'use client'

import Image from 'next/image'
import { Minus, Plus, Trash2, Package, ShoppingCart, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/app/numeric-input'
import { formatARS } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/app/empty-state'
import type { ItemCarrito } from '../_hooks/use-carrito'

type CarritoPanelProps = {
  items: ItemCarrito[]
  subtotal: number
  descuentoValor: number
  descuentoModo: 'porcentaje' | 'monto'
  descuentoAplicado: number
  total: number
  cantidadItems: number
  onCantidadChange: (varianteId: string, cantidad: number) => void
  onRemove: (varianteId: string) => void
  onLimpiar: () => void
  onCobrar: () => void
  onGuardarPedido: () => void
  onDescuentoValorChange: (valor: number) => void
  onDescuentoModoChange: (modo: 'porcentaje' | 'monto') => void
  puedeCobrarDirecto: boolean
}

export function CarritoPanel({
  items,
  subtotal,
  descuentoValor,
  descuentoModo,
  descuentoAplicado,
  total,
  cantidadItems,
  onCantidadChange,
  onRemove,
  onLimpiar,
  onCobrar,
  onGuardarPedido,
  onDescuentoValorChange,
  onDescuentoModoChange,
  puedeCobrarDirecto,
}: CarritoPanelProps) {
  const vacio = items.length === 0

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-5" />
          <h2 className="font-semibold">Venta en curso</h2>
          {!vacio && (
            <span className="text-xs text-muted-foreground font-numeric">
              ({cantidadItems} {cantidadItems === 1 ? 'ítem' : 'ítems'})
            </span>
          )}
        </div>
        {!vacio && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onLimpiar}
            className="text-destructive hover:text-destructive h-9 text-xs touch-target"
            title="Vaciar carrito (F9)"
          >
            <Trash2 className="size-3.5 mr-1" />
            Vaciar
          </Button>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {vacio ? (
          <div className="flex h-full items-center justify-center p-4">
            <EmptyState
              icon={<ShoppingCart />}
              title="Carrito vacío"
              description={
                puedeCobrarDirecto
                  ? 'Tocá un producto para agregarlo al carrito.'
                  : 'Tocá un producto para agregarlo al pedido.'
              }
              size="sm"
              className="border-none"
            />
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <CarritoItem
                key={item.varianteId}
                item={item}
                onCantidadChange={(c) => onCantidadChange(item.varianteId, c)}
                onRemove={() => onRemove(item.varianteId)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Totales + acciones */}
      {!vacio && (
        <div className="border-t bg-muted/20 p-4 space-y-3">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal neto</span>
              <span className="font-numeric">{formatARS(subtotal)}</span>
            </div>
            {puedeCobrarDirecto && descuentoAplicado > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Descuento</span>
                <span className="font-numeric">
                  − {formatARS(descuentoAplicado)}
                </span>
              </div>
            )}
          </div>

          {puedeCobrarDirecto && (
            /* DESCUENTO */
            <div className="space-y-1.5 pt-1 border-t border-border/30">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  Descuento (opcional)
                </Label>
                <div
                  className="flex rounded-md border bg-background p-0.5"
                  role="group"
                  aria-label="Modo de descuento"
                >
                  <button
                    type="button"
                    onClick={() => onDescuentoModoChange('porcentaje')}
                    aria-pressed={descuentoModo === 'porcentaje'}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs font-medium font-numeric transition-colors',
                      descuentoModo === 'porcentaje'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => onDescuentoModoChange('monto')}
                    aria-pressed={descuentoModo === 'monto'}
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs font-medium transition-colors',
                      descuentoModo === 'monto'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    $
                  </button>
                </div>
              </div>
              {descuentoModo === 'porcentaje' ? (
                <div className="relative">
                  <NumericInput
                    value={descuentoValor === 0 ? null : descuentoValor}
                    onChange={(v) => onDescuentoValorChange(v ?? 0)}
                    decimals={1}
                    min={0}
                    max={100}
                    allowEmpty
                    placeholder="0"
                    className="h-9 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                    %
                  </span>
                </div>
              ) : (
                <NumericInput
                  value={descuentoValor === 0 ? null : descuentoValor}
                  onChange={(v) => onDescuentoValorChange(v ?? 0)}
                  decimals={2}
                  min={0}
                  max={subtotal}
                  allowEmpty
                  prefix="$"
                  placeholder="0,00"
                  className="h-9"
                />
              )}
            </div>
          )}

          <Separator />

          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Total</span>
            <span className="font-numeric text-2xl font-bold">
              {formatARS(total)}
            </span>
          </div>

          {/* Botones según rol. H-12 = 48px, por encima del mínimo de 44px de Apple HIG */}
          {puedeCobrarDirecto ? (
            <div className="space-y-2">
              <Button
                onClick={onCobrar}
                className="w-full h-12 text-base touch-target"
                size="lg"
              >
                Cobrar <span className="hidden md:inline ml-1">(F5)</span>
              </Button>
              <Button
                onClick={onGuardarPedido}
                variant="outline"
                className="w-full h-11 text-sm touch-target"
              >
                <Save className="size-4 mr-2" />
                Guardar pedido <span className="hidden md:inline ml-1">(F2)</span>
              </Button>
            </div>
          ) : (
            <Button
              onClick={onGuardarPedido}
              className="w-full h-12 text-base touch-target"
              size="lg"
            >
              <Save className="size-4 mr-2" />
              Guardar pedido <span className="hidden md:inline ml-1">(F2)</span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function CarritoItem({
  item,
  onCantidadChange,
  onRemove,
}: {
  item: ItemCarrito
  onCantidadChange: (cantidad: number) => void
  onRemove: () => void
}) {
  const subtotalItem = item.precioUnitarioNeto * item.cantidad
  const varianteLabel = formatAtributos(item.atributos) || null
  const enMaximo = item.trackStock && item.cantidad >= item.stockDisponible
  const maxCantidad = item.trackStock ? item.stockDisponible : undefined

  return (
    <li className="p-3 group">
      <div className="flex gap-3">
        {/* Thumb */}
        {item.imagenUrl ? (
          <div className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
            <Image
              src={item.imagenUrl}
              alt={item.productoNombre}
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

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight line-clamp-2">
                {item.productoNombre}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {varianteLabel && <span>{varianteLabel} · </span>}
                <span className="font-numeric">{item.skuVariante}</span>
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              className="size-9 text-muted-foreground hover:text-destructive -mr-1 -mt-1 touch-target"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            {/* Cantidad: controles a 44px para dedo */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => onCantidadChange(item.cantidad - 1)}
                disabled={item.cantidad <= 1}
                className="size-11 touch-target"
              >
                <Minus className="size-4" />
              </Button>
              <NumericInput
                value={item.cantidad}
                onChange={(val) => {
                  if (val !== null && val >= 1) onCantidadChange(val)
                }}
                min={1}
                max={maxCantidad}
                decimals={0}
                className="h-11 w-16 text-center text-base px-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => onCantidadChange(item.cantidad + 1)}
                disabled={enMaximo}
                className="size-11 touch-target"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {/* Subtotal */}
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-numeric">
                {formatARS(item.precioUnitarioNeto)} c/u
              </p>
              <p className="text-sm font-semibold font-numeric">
                {formatARS(subtotalItem)}
              </p>
            </div>
          </div>

          {enMaximo && (
            <p className="text-[10px] text-warning mt-1">
              Stock máximo alcanzado ({item.stockDisponible})
            </p>
          )}
        </div>
      </div>
    </li>
  )
}