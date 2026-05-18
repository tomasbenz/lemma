'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { anularPedidosBulk } from '../_actions/anular-pedidos-bulk'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pedidoIds: string[]
  onSuccess: () => void
}

export function BulkAnularDialog({
  open,
  onOpenChange,
  pedidoIds,
  onSuccess,
}: Props) {
  const [motivo, setMotivo] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    const motivoLimpio = motivo.trim()
    if (!motivoLimpio) {
      toast.error('El motivo es obligatorio')
      return
    }

    setLoading(true)
    const result = await anularPedidosBulk(pedidoIds, motivoLimpio)
    setLoading(false)

    if (!result.ok && result.exitosos === 0) {
      toast.error(
        result.fallidos[0]?.error ?? 'No se pudo anular ningún pedido',
      )
      return
    }

    if (result.fallidos.length === 0) {
      toast.success(
        `${result.exitosos} ${result.exitosos === 1 ? 'pedido anulado' : 'pedidos anulados'}`,
      )
    } else {
      toast.warning(
        `${result.exitosos} anulados, ${result.fallidos.length} fallaron`,
        {
          description: result.fallidos
            .slice(0, 3)
            .map((f) => `#${f.numero ?? '?'}: ${f.error}`)
            .join('; '),
        },
      )
    }

    setMotivo('')
    onSuccess()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Anular {pedidoIds.length}{' '}
            {pedidoIds.length === 1 ? 'pedido' : 'pedidos'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Los pedidos quedarán como
            anulados y se va a registrar el motivo en el historial.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="motivo-bulk">Motivo (obligatorio)</Label>
          <Input
            id="motivo-bulk"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: pedidos de prueba duplicados"
            maxLength={500}
            disabled={loading}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading || !motivo.trim()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Anulando...
              </>
            ) : (
              'Anular pedidos'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
