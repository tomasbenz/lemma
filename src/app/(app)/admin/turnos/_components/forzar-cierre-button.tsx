// src/app/(app)/admin/turnos/_components/forzar-cierre-button.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { forzarCierreTurno } from '../_actions/forzar-cierre-turno'

type Props = {
  turnoId: string
}

export function ForzarCierreButton({ turnoId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const motivoLimpio = motivo.trim()
    if (!motivoLimpio) {
      toast.error('El motivo es obligatorio')
      return
    }

    setSubmitting(true)
    const result = await forzarCierreTurno({
      turnoId,
      motivo: motivoLimpio,
    })

    if (!result.ok) {
      toast.error(result.error)
      setSubmitting(false)
      return
    }

    toast.success('Turno cerrado por admin')
    setOpen(false)
    setMotivo('')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <AlertTriangle className="size-3.5" />
        Forzar cierre
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!submitting) setOpen(o)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Forzar cierre del turno</DialogTitle>
            <DialogDescription>
              Esta acción cierra el turno sin total declarado y queda
              registrada en auditoría. Usala cuando la cajera olvidó cerrarlo
              y ya no está disponible.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="motivo">Motivo (obligatorio)</Label>
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: cajera olvidó cerrar"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Cerrando...
                </>
              ) : (
                'Forzar cierre'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
