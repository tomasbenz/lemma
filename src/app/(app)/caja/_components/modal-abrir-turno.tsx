// src/app/(app)/caja/_components/modal-abrir-turno.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import { abrirTurno } from '../_actions/abrir-turno'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModalAbrirTurno({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [baseInicial, setBaseInicial] = useState('')
  const [notaApertura, setNotaApertura] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setBaseInicial('')
    setNotaApertura('')
    setSubmitting(false)
  }

  async function handleSubmit() {
    const baseNumero = Number(baseInicial.replace(',', '.'))
    if (!Number.isFinite(baseNumero) || baseNumero < 0) {
      toast.error('La base inicial debe ser un número mayor o igual a cero')
      return
    }

    setSubmitting(true)
    const result = await abrirTurno({
      baseInicial: baseNumero,
      notaApertura: notaApertura.trim() || undefined,
    })

    if (!result.ok) {
      toast.error(result.error)
      setSubmitting(false)
      return
    }

    toast.success('Turno abierto')
    reset()
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) {
          if (!o) reset()
          onOpenChange(o)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Abrir turno de caja
          </DialogTitle>
          <DialogDescription>
            Indicá con cuánto efectivo arranca la caja. Vas a tener que
            declarar el conteo final al cerrar el turno para detectar
            diferencias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="base-inicial">Base inicial (efectivo en caja)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="base-inicial"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={baseInicial}
                onChange={(e) => setBaseInicial(e.target.value)}
                onFocus={selectAllOnFocus}
                className="pl-7 font-numeric tabular-nums"
                disabled={submitting}
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nota-apertura">Nota (opcional)</Label>
            <Input
              id="nota-apertura"
              type="text"
              placeholder="Ej: turno mañana, reemplazo, etc."
              value={notaApertura}
              onChange={(e) => setNotaApertura(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Abriendo...
              </>
            ) : (
              'Abrir turno'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
