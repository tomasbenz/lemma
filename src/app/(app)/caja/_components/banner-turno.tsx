// src/app/(app)/caja/_components/banner-turno.tsx
'use client'

import { useState } from 'react'
import { Clock, LockKeyhole } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatARS } from '@/lib/format'
import type { TurnoActivo } from '@/lib/queries/turnos'
import { ModalCerrarTurno } from './modal-cerrar-turno'

type Props = {
  turno: TurnoActivo
}

function formatHora(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function BannerTurno({ turno }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div className="border-b bg-muted/30 px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="size-3.5 shrink-0" />
          <span className="font-medium">Turno abierto</span>
          <span className="text-muted-foreground hidden sm:inline">·</span>
          <span className="text-muted-foreground truncate hidden sm:inline">
            base <span className="font-numeric tabular-nums">{formatARS(turno.base_inicial)}</span>
            {' · '}
            desde <span className="font-numeric tabular-nums">{formatHora(turno.abierto_at)}</span>
            {turno.usuario_apertura_nombre ? (
              <>
                {' · '}
                por <span className="font-medium">{turno.usuario_apertura_nombre}</span>
              </>
            ) : null}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModalOpen(true)}
          className="h-7 gap-1.5 text-xs"
        >
          <LockKeyhole className="size-3.5" />
          Cerrar turno
        </Button>
      </div>

      <ModalCerrarTurno
        open={modalOpen}
        onOpenChange={setModalOpen}
        turnoId={turno.id}
        baseInicial={turno.base_inicial}
      />
    </>
  )
}
