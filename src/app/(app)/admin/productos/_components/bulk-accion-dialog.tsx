'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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
import {
  bulkActualizarProductos,
  type BulkActualizarInput,
} from '../_actions/bulk-actualizar-productos'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Builder lazy del input. Se invoca en el handler de confirmar, no en el render,
   * para que el snapshot de ids sea reciente y los campos del formulario (Paso 5)
   * lean el estado más actual.
   */
  buildInput: () => BulkActualizarInput | null
  titulo: string
  descripcion?: string
  confirmLabel: string
  destructive?: boolean
  onSuccess: () => void
  children?: ReactNode
}

export function BulkAccionDialog({
  open,
  onOpenChange,
  buildInput,
  titulo,
  descripcion,
  confirmLabel,
  destructive,
  onSuccess,
  children,
}: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleConfirm(e: React.MouseEvent) {
    // Evitamos el cierre automático del AlertDialogAction de Radix: queremos
    // mantener el modal abierto si la action falla, para que el usuario
    // pueda reintentar o cancelar.
    e.preventDefault()

    const input = buildInput()
    if (!input) {
      toast.error('Faltan datos para aplicar la acción')
      return
    }

    setLoading(true)
    try {
      const res = await bulkActualizarProductos(input)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        `${res.afectados} producto${res.afectados === 1 ? '' : 's'} actualizado${res.afectados === 1 ? '' : 's'}`,
        res.omitidos.length > 0
          ? {
              description: `${res.omitidos.length} omitido${res.omitidos.length === 1 ? '' : 's'} (no aplicaba la acción).`,
              action: res.operacionId
                ? {
                    label: 'Ver omitidos',
                    onClick: () =>
                      router.push(`/admin/operaciones/${res.operacionId}`),
                  }
                : undefined,
            }
          : undefined
      )
      onOpenChange(false)
      onSuccess()
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descripcion && (
            <AlertDialogDescription>{descripcion}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {children}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className={
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
          >
            {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
            {loading ? 'Aplicando…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
