'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { SelectorCliente } from '@/app/(app)/caja/_components/selector-cliente'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'
import { asignarClienteBulk } from '../_actions/asignar-cliente-bulk'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pedidoIds: string[]
  clientes: ClienteCaja[]
  onSuccess: () => void
}

export function BulkClienteDialog({
  open,
  onOpenChange,
  pedidoIds,
  clientes,
  onSuccess,
}: Props) {
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    const result = await asignarClienteBulk(pedidoIds, clienteId)
    setLoading(false)

    if (!result.ok && result.exitosos === 0) {
      toast.error(
        result.fallidos[0]?.error ?? 'No se pudo asignar el cliente',
      )
      return
    }

    if (result.fallidos.length === 0) {
      toast.success(
        `Cliente asignado a ${result.exitosos} ${result.exitosos === 1 ? 'pedido' : 'pedidos'}`,
      )
    } else {
      toast.warning(
        `${result.exitosos} actualizados, ${result.fallidos.length} fallaron`,
      )
    }

    setClienteId(null)
    onSuccess()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-md">
        <DialogHeader>
          <DialogTitle>
            Asignar cliente a {pedidoIds.length}{' '}
            {pedidoIds.length === 1 ? 'pedido' : 'pedidos'}
          </DialogTitle>
          <DialogDescription>
            Se va a reemplazar el cliente actual de los pedidos seleccionados.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <SelectorCliente
            clientes={clientes}
            clienteId={clienteId}
            onChange={setClienteId}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Asignando...
              </>
            ) : (
              'Asignar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
