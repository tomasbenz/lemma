'use client'

import { type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  titulo: string
  descripcion?: string
  /** Texto del botón primario (ej. "Revisar cambios"). */
  confirmLabel: string
  /** Se invoca al confirmar la regla. NO aplica nada: dispara el paso de preview. */
  onConfirm: () => void
  loading: boolean
  /** Deshabilita el botón primario (regla incompleta). */
  confirmDisabled?: boolean
  children: ReactNode
}

/**
 * Modal del paso "regla base" para las acciones de Fase 2 (precio_pct, stock).
 * Recolecta los inputs (vía children = los FormX de bulk-forms) y, al confirmar,
 * dispara el paso de preview editable. NO ejecuta el wrapper: la aplicación
 * real ocurre desde BulkPreviewDialog. Mantiene a BulkAccionDialog (Fase 1)
 * intacto.
 */
export function BulkReglaDialog({
  open,
  onOpenChange,
  titulo,
  descripcion,
  confirmLabel,
  onConfirm,
  loading,
  confirmDisabled,
  children,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
        </DialogHeader>

        <div className="py-1">{children}</div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
            {loading ? 'Cargando…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
