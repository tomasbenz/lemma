'use client'

import { useState, useEffect } from 'react'
import { Loader2, WifiOff, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/app/numeric-input'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { cambiarPrecioCaja } from '../_actions/cambiar-precio-caja'

export function ModalCambiarPrecio({
  open,
  onOpenChange,
  productoId,
  productoNombre,
  precioActual,
  offline,
  onCambioOk,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  productoId: string
  productoNombre: string
  precioActual: number
  offline: boolean
  /** Se llama tras un cambio exitoso para que el padre actualice el carrito. */
  onCambioOk: (precioNuevo: number) => void
}) {
  const [precioNuevo, setPrecioNuevo] = useState<number | null>(precioActual)
  const [razon, setRazon] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset al abrir: precio nuevo arranca = actual, razón vacía.
  useEffect(() => {
    if (open) {
      setPrecioNuevo(precioActual)
      setRazon('')
      setIsSubmitting(false)
    }
  }, [open, precioActual])

  const precioValido = precioNuevo !== null && precioNuevo > 0
  const sinCambio = precioNuevo !== null && precioNuevo === precioActual
  const diferencia = precioValido ? precioNuevo - precioActual : 0
  const difPct =
    precioValido && precioActual > 0
      ? (diferencia / precioActual) * 100
      : 0
  // Warning NO bloqueante si baja más del 50%.
  const granBaja = precioValido && precioNuevo < precioActual * 0.5

  const puedeConfirmar =
    precioValido && !sinCambio && !offline && !isSubmitting

  async function handleConfirm() {
    if (!puedeConfirmar || precioNuevo === null) return
    setIsSubmitting(true)
    try {
      const result = await cambiarPrecioCaja({
        productoId,
        precioNuevo,
        razon,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onCambioOk(result.precioNuevo)
      toast.success('Precio actualizado correctamente. Se registró en el historial.')
      onOpenChange(false)
    } catch (error) {
      console.error(error)
      toast.error('Error inesperado')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">
            Cambiar precio de {productoNombre}
          </DialogTitle>
          <DialogDescription>
            Esto actualizará el precio en el catálogo. Todas las variantes del
            producto usarán el nuevo precio.
          </DialogDescription>
        </DialogHeader>

        {offline ? (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
            <WifiOff className="size-4 shrink-0" />
            <span>Necesitás conexión para cambiar precios.</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cambiar-precio-nuevo">Precio nuevo</Label>
              <NumericInput
                id="cambiar-precio-nuevo"
                value={precioNuevo}
                onChange={setPrecioNuevo}
                decimals={2}
                min={0}
                prefix="$"
                allowEmpty
                disabled={isSubmitting}
                className="h-11 text-base"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cambiar-precio-razon">Razón del cambio</Label>
              <Input
                id="cambiar-precio-razon"
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
                placeholder="Opcional. Ej: error de carga, promo de fin de semana…"
                maxLength={200}
                disabled={isSubmitting}
              />
            </div>

            {/* Preview */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Precio actual</span>
                <span className="font-numeric">{formatARS(precioActual)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Precio nuevo</span>
                <span className="font-numeric font-semibold">
                  {precioValido ? formatARS(precioNuevo) : '—'}
                </span>
              </div>
              {precioValido && !sinCambio && (
                <div
                  className={cn(
                    'flex justify-between pt-1 border-t border-border/40',
                    diferencia < 0 ? 'text-destructive' : 'text-foreground'
                  )}
                >
                  <span>Diferencia</span>
                  <span className="font-numeric">
                    {diferencia > 0 ? '+' : ''}
                    {formatARS(diferencia)} ({difPct > 0 ? '+' : ''}
                    {Math.round(difPct * 10) / 10}%)
                  </span>
                </div>
              )}
            </div>

            {granBaja && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs text-warning">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  Estás bajando el precio más del 50%. Confirmá que es correcto.
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!puedeConfirmar}>
            {isSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
            {isSubmitting ? 'Guardando…' : 'Confirmar cambio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
