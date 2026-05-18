// src/app/(app)/caja/_components/modal-guardar-pedido.tsx
'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2, Package, Info, WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatARS } from '@/lib/format'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import { SelectorCliente } from './selector-cliente'
import {
  guardarPedido,
  type GuardarPedidoInput,
} from '../_actions/guardar-pedido'
import type { ItemVentaInput } from '../_actions/cerrar-venta'
import type { ItemCarrito } from '../_hooks/use-carrito'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'
import { useOnlineStatus } from '@/lib/offline/use-online-status'
import { enqueuePedidoOffline } from '@/lib/offline/order-queue'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ItemCarrito[]
  clientes: ClienteCaja[]
  clienteId: string | null
  onClienteChange: (id: string | null) => void
  subtotal: number
  onPedidoGuardado: (ventaId: string, numero: number) => void
  userId: string
}

function isNetworkError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('internet_disconnected') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('connection') ||
    lower.includes('timeout')
  )
}

export function ModalGuardarPedido({
  open,
  onOpenChange,
  items,
  clientes,
  clienteId,
  onClienteChange,
  subtotal,
  onPedidoGuardado,
  userId,
}: Props) {
  const [notaInterna, setNotaInterna] = useState('')
  const [nombreClienteCustom, setNombreClienteCustom] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { isOnline } = useOnlineStatus()

  useEffect(() => {
    if (open) {
      setNotaInterna('')
      setNombreClienteCustom('')
    }
  }, [open])

  const cantidadItems = items.reduce((acc, i) => acc + i.cantidad, 0)

  async function guardarOffline(razon: 'sin-conexion' | 'server-no-responde') {
    try {
      const localId = await enqueuePedidoOffline({
        clienteId,
        nombreClienteCustom: nombreClienteCustom.trim() || undefined,
        items,
        notaInterna: notaInterna.trim() || undefined,
        usuarioId: userId,
      })

      const description =
        razon === 'sin-conexion'
          ? 'Se va a sincronizar automáticamente cuando vuelva la conexión.'
          : 'El servidor no respondió. Se va a sincronizar cuando se restablezca la conexión.'

      toast.success('Pedido guardado offline', {
        description,
        duration: 4500,
      })

      onPedidoGuardado(localId, 0)
      onOpenChange(false)
      return true
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'No se pudo guardar el pedido offline'
      )
      return false
    }
  }

  async function handleConfirmar() {
    setSubmitting(true)

    if (!isOnline) {
      await guardarOffline('sin-conexion')
      setSubmitting(false)
      return
    }

    const itemsRpc: ItemVentaInput[] = items.map((i) => ({
      varianteId: i.varianteId,
      productoNombre: i.productoNombre,
      productoSku: i.productoSku,
      skuVariante: i.skuVariante,
      atributos: i.atributos,
      cantidad: i.cantidad,
      precioUnitarioNeto: i.precioUnitarioNeto,
    }))

    const payload: GuardarPedidoInput = {
      clienteId,
      nombreClienteCustom: nombreClienteCustom.trim() || undefined,
      items: itemsRpc,
      notaInterna: notaInterna.trim() || undefined,
    }

    let result
    try {
      result = await guardarPedido(payload)
    } catch (err) {
      if (isNetworkError(err)) {
        await guardarOffline('server-no-responde')
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Error inesperado al guardar'
        )
      }
      setSubmitting(false)
      return
    }

    setSubmitting(false)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    toast.success(`Pedido #${result.numero} guardado`)
    onPedidoGuardado(result.ventaId, result.numero)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle>Guardar pedido</DialogTitle>
          <DialogDescription>
            El pedido queda pendiente para que el administrador lo finalice.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6 pt-4 min-h-0 space-y-5">
          {!isOnline && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
              <WifiOff className="size-4 shrink-0 mt-0.5 text-warning" />
              <div className="text-foreground">
                <p className="font-medium mb-0.5">Modo offline</p>
                <p className="text-muted-foreground">
                  El pedido se va a guardar en este dispositivo y se enviará
                  al sistema automáticamente cuando vuelva la conexión.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-md border p-3 bg-muted/20 flex items-center gap-3">
            <div className="size-9 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Package className="size-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {cantidadItems} {cantidadItems === 1 ? 'unidad' : 'unidades'}{' '}
                en {items.length} {items.length === 1 ? 'ítem' : 'ítems'}
              </p>
              <p className="text-xs text-muted-foreground">
                Subtotal neto{' '}
                <span className="font-numeric font-medium text-foreground">
                  {formatARS(subtotal)}
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Cliente (opcional)</Label>
            <SelectorCliente
              clientes={clientes}
              clienteId={clienteId}
              onChange={onClienteChange}
            />

            <div className="pt-1">
              <Label
                htmlFor="nombre-cliente-custom-pedido"
                className="text-xs text-muted-foreground"
              >
                Nombre / referencia personalizada (opcional)
              </Label>
              <Input
                id="nombre-cliente-custom-pedido"
                value={nombreClienteCustom}
                onChange={(e) => setNombreClienteCustom(e.target.value)}
                onFocus={selectAllOnFocus}
                placeholder="Ej: TOMAS BENZ #32009"
                maxLength={100}
                className="mt-1"
              />
            </div>

            {!clienteId && !nombreClienteCustom && (
              <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 p-2.5 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0 mt-0.5 text-info" />
                <p>
                  ¿No está el cliente en la lista? Usá el campo de arriba para
                  poner una referencia (nombre, alias, número de pedido web), o
                  dejá los datos completos en la nota.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nota-pedido" className="text-sm font-medium">
              Nota para el administrador (opcional)
            </Label>
            <Input
              id="nota-pedido"
              value={notaInterna}
              onChange={(e) => setNotaInterna(e.target.value)}
              onFocus={selectAllOnFocus}
              placeholder="Ej: cliente pasa a pagar mañana"
              maxLength={200}
            />
          </div>
        </div>

        <div className="border-t p-4 bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={submitting}
            className="min-w-35"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Check className="size-4 mr-2" />
                {isOnline ? 'Guardar pedido' : 'Guardar offline'}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}