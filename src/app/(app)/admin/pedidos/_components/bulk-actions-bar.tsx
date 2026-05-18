'use client'

import { X, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  seleccionados: number
  onLimpiar: () => void
  onAnular: () => void
  onAsignarCliente: () => void
  className?: string
}

export function BulkActionsBar({
  seleccionados,
  onLimpiar,
  onAnular,
  onAsignarCliente,
  className,
}: Props) {
  if (seleccionados === 0) return null

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-elev-3',
        'enter-up',
        className,
      )}
      role="region"
      aria-label="Acciones masivas"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onLimpiar}
        className="h-8 -ml-1"
      >
        <X className="size-3.5 mr-1" />
      </Button>

      <span className="text-sm font-medium">
        <span className="font-numeric tabular-nums">{seleccionados}</span>{' '}
        {seleccionados === 1 ? 'pedido seleccionado' : 'pedidos seleccionados'}
      </span>

      <div className="ml-2 flex items-center gap-1.5 border-l pl-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onAsignarCliente}
          className="h-8 gap-1.5"
        >
          <UserPlus className="size-3.5" />
          Asignar cliente
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onAnular}
          className="h-8 gap-1.5 text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Anular
        </Button>
      </div>
    </div>
  )
}
