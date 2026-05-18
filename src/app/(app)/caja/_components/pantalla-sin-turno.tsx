// src/app/(app)/caja/_components/pantalla-sin-turno.tsx
'use client'

import { useState } from 'react'
import { Lock, KeyRound, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { CurrentUser } from '@/lib/auth/get-current-user'
import { ModalAbrirTurno } from './modal-abrir-turno'

type Motivo = 'sin_turno' | 'sin_empresa'

type Props = {
  user: CurrentUser
  motivo: Motivo
}

export function PantallaSinTurno({ user, motivo }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  if (motivo === 'sin_empresa') {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14))] items-center justify-center p-6">
        <Card className="max-w-md w-full p-6 text-center space-y-3">
          <AlertCircle className="size-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold">Sin empresa asignada</h2>
          <p className="text-sm text-muted-foreground">
            Tu usuario no está asociado a una empresa. Pedile a un admin que
            te asigne para poder operar la caja.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14))] items-center justify-center p-6">
      <Card className="max-w-lg w-full p-8 text-center space-y-5">
        <div className="flex justify-center">
          <div className="size-14 rounded-full bg-muted flex items-center justify-center">
            <Lock className="size-7 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-semibold">Caja sin turno abierto</h2>
          <p className="text-sm text-muted-foreground">
            Para registrar ventas tenés que abrir un turno indicando cuánto
            efectivo arrancás en la caja. Al cerrar el turno vas a declarar
            el efectivo final y el sistema calcula la diferencia.
          </p>
        </div>

        <div className="flex justify-center pt-1">
          <Button
            size="lg"
            onClick={() => setModalOpen(true)}
            className="gap-2"
          >
            <KeyRound className="size-4" />
            Abrir turno
          </Button>
        </div>

        <p className="text-xs text-muted-foreground/70 pt-1">
          Vas a operar como <span className="font-medium">{user.nombre_completo ?? user.email}</span>
        </p>
      </Card>

      <ModalAbrirTurno open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
