'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cambiarEstadoProducto } from '../_actions/cambiar-estado'

export function CambiarEstadoButton({
  productoId,
  productoNombre,
  activo,
}: {
  productoId: string
  productoNombre: string
  activo: boolean
}) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleConfirm() {
    setIsSubmitting(true)
    try {
      const result = await cambiarEstadoProducto(productoId, !activo)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        activo
          ? `"${productoNombre}" desactivado`
          : `"${productoNombre}" reactivado`
      )
      setOpen(false)
      router.refresh()
    } catch (error) {
      console.error(error)
      toast.error('Error inesperado')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          {activo ? (
            <>
              <Archive className="size-4 mr-2" />
              Desactivar
            </>
          ) : (
            <>
              <ArchiveRestore className="size-4 mr-2" />
              Reactivar
            </>
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {activo ? 'Desactivar producto' : 'Reactivar producto'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {activo ? (
              <>
                Vas a desactivar <strong>{productoNombre}</strong>. No aparecerá
                en el listado ni en la caja, pero se mantiene todo su historial
                de ventas. Podés reactivarlo en cualquier momento.
              </>
            ) : (
              <>
                Vas a reactivar <strong>{productoNombre}</strong>. Volverá a
                aparecer en el listado y se podrá vender.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleConfirm()
            }}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? 'Procesando...'
              : activo
                ? 'Desactivar'
                : 'Reactivar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}