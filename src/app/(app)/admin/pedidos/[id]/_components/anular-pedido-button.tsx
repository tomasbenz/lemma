// src/app/(app)/admin/pedidos/[id]/_components/anular-pedido-button.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { anularPedido } from '../../_actions/anular-pedido'

type Props = {
  pedidoId: string
  numero: number
}

export function AnularPedidoButton({ pedidoId, numero }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirmar() {
    const motivoLimpio = motivo.trim()
    if (!motivoLimpio) {
      toast.error('Ingresá un motivo para anular el pedido')
      return
    }

    setSubmitting(true)
    const result = await anularPedido(pedidoId, motivoLimpio)
    setSubmitting(false)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    toast.success(`Pedido #${numero} anulado`)
    setOpen(false)
    setMotivo('')
    router.push('/admin/pedidos')
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/40"
      >
        <XCircle className="size-4 mr-2" />
        Anular pedido
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular pedido #{numero}</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a descartar este pedido. No afecta stock (porque nunca se
              descontó), pero el pedido queda marcado como anulado y desaparece
              del listado de pendientes. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label
              htmlFor="motivo-anulacion-pedido"
              className="text-xs text-muted-foreground"
            >
              Motivo (obligatorio, queda registrado)
            </Label>
            <Input
              id="motivo-anulacion-pedido"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: cliente canceló, error al armar..."
              maxLength={200}
              disabled={submitting}
              autoFocus
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmar()
              }}
              disabled={submitting || !motivo.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Anulando...
                </>
              ) : (
                <>
                  <XCircle className="size-4 mr-2" />
                  Sí, anular pedido
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}