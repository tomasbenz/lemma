'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Check, Loader2 } from 'lucide-react'
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
import { cambiarEstadoCliente } from '../[id]/_actions/cambiar-estado-cliente'

type Props = {
  clienteId: string
  razonSocial: string
  activo: boolean
}

export function CambiarEstadoClienteButton({
  clienteId,
  razonSocial,
  activo,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirmar() {
    startTransition(async () => {
      const result = await cambiarEstadoCliente(clienteId, !activo)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(activo ? 'Cliente desactivado' : 'Cliente activado')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={isPending}
        className={
          activo
            ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
            : ''
        }
      >
        {activo ? (
          <>
            <Ban className="size-4 mr-2" />
            Desactivar
          </>
        ) : (
          <>
            <Check className="size-4 mr-2" />
            Reactivar
          </>
        )}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {activo ? 'Desactivar' : 'Reactivar'} a {razonSocial}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activo
                ? 'El cliente ya no aparecerá en búsquedas ni como opción al cobrar. Las ventas anteriores se mantienen intactas.'
                : 'El cliente volverá a aparecer en búsquedas y podrá ser asignado a nuevas ventas.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmar()
              }}
              disabled={isPending}
              variant={activo ? 'destructive' : 'default'}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : activo ? (
                'Desactivar cliente'
              ) : (
                'Reactivar cliente'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}