// src/components/app/superadmin-banner.tsx
'use client'

import { useTransition } from 'react'
import { ShieldAlert, ArrowLeft, Loader2 } from 'lucide-react'
import { salirDeEmpresa } from '@/app/superadmin/_actions/empresa-impersonacion'

/**
 * Strip visible cuando un superadmin está operando dentro de una empresa
 * específica (modo impersonación). Se renderiza dentro del wrapper sticky
 * superior del layout para que quede siempre visible mientras se scrollea.
 *
 * Paleta achromatic estricta (negro/blanco) — sin acento de color, alineada
 * con la identidad visual del cliente.
 */
export function SuperadminBanner({
  empresaNombre,
}: {
  empresaNombre: string
}) {
  const [isPending, startTransition] = useTransition()

  function salir() {
    startTransition(async () => {
      await salirDeEmpresa()
    })
  }

  return (
    <div className="bg-black text-white border-b border-white/10 px-4 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs min-w-0">
        <ShieldAlert className="size-4 shrink-0" />
        <span className="truncate">
          Operando como superadmin en{' '}
          <span className="font-semibold">{empresaNombre}</span>
        </span>
      </div>

      <button
        type="button"
        onClick={salir}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-white/30 bg-transparent text-white hover:bg-white hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowLeft className="size-3.5" />
        )}
        Volver al panel
      </button>
    </div>
  )
}
