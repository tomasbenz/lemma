// src/app/(app)/admin/ventas/_components/anular-venta-button.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { anularVenta } from '../_actions/anular-venta'

/**
 * Info opcional de factura AFIP aprobada activa. Si la venta tiene una
 * factura aprobada (sin NC posterior), el modal muestra un warning
 * destacado avisando que la anulación va a emitir una Nota de Crédito
 * en AFIP automáticamente.
 *
 * `tipo`: 'A' o 'B' para mostrar visible al admin.
 * `comprobante`: ya formateado como '0001-00000001'.
 */
type FacturaAprobadaActiva = {
  tipo: 'A' | 'B'
  comprobante: string
}

type AnularVentaButtonProps = {
  ventaId: string
  numero: number
  disabled?: boolean
  facturaAprobadaActiva?: FacturaAprobadaActiva
}

export function AnularVentaButton({
  ventaId,
  numero,
  disabled,
  facturaAprobadaActiva,
}: AnularVentaButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleConfirmar() {
    const motivoLimpio = motivo.trim()
    if (!motivoLimpio) {
      toast.error('Ingresá un motivo para anular la venta')
      return
    }

    startTransition(async () => {
      const result = await anularVenta(ventaId, motivoLimpio)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(`Venta #${result.numero} anulada`)
      setOpen(false)
      setMotivo('')
      router.refresh()
    })
  }

  const tieneFactura = !!facturaAprobadaActiva

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled || isPending}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Ban className="size-4 mr-2" />
        Anular venta
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular venta #{numero}</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción va a marcar la venta como anulada y{' '}
              <strong>restaurar el stock</strong> de todos los productos
              vendidos. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {tieneFactura && (
            <div
              className={cn(
                'rounded-md border p-3 text-sm',
                'border-warning/40 bg-warning/10',
              )}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium mb-0.5">
                    Esta venta tiene factura AFIP aprobada
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Factura {facturaAprobadaActiva.tipo} N°{' '}
                    <span className="font-numeric">
                      {facturaAprobadaActiva.comprobante}
                    </span>
                    . Anularla va a emitir una <strong>Nota de Crédito</strong>{' '}
                    en AFIP automáticamente. La NC queda registrada y no se
                    puede deshacer.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="motivo-anulacion-venta"
              className="text-xs text-muted-foreground"
            >
              Motivo (obligatorio, queda registrado)
            </Label>
            <Input
              id="motivo-anulacion-venta"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: error al cobrar, devolución del cliente..."
              maxLength={200}
              disabled={isPending}
              autoFocus
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmar()
              }}
              disabled={isPending || !motivo.trim()}
              variant="destructive"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Anulando...
                </>
              ) : (
                <>
                  <Ban className="size-4 mr-2" />
                  Confirmar anulación
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
