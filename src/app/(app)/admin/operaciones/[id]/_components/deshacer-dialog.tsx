'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

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
import { revertirOperacion } from '../_actions/revertir-operacion'

export function DeshacerDialog({
  open,
  onOpenChange,
  operacionId,
  cantidad,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  operacionId: string
  cantidad: number
}) {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  async function confirmar() {
    setLoading(true)
    const res = await revertirOperacion(operacionId)
    setLoading(false)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo deshacer')
      return
    }
    toast.success(
      `Precios restaurados en ${res.afectados} ${res.afectados === 1 ? 'producto' : 'productos'}.`
    )
    onOpenChange(false)
    if (res.nueva_operacion_id) {
      router.push(`/admin/operaciones/${res.nueva_operacion_id}`)
    } else {
      router.refresh()
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Deshacer esta operación?</AlertDialogTitle>
          <AlertDialogDescription>
            Se restaurarán los precios anteriores en {cantidad}{' '}
            {cantidad === 1 ? 'producto' : 'productos'}. Esta acción quedará
            registrada como una nueva operación.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirmar()
            }}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
            Sí, deshacer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
