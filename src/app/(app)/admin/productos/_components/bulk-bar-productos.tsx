'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useSeleccionStore,
  useSeleccionCantidad,
} from '../_state/seleccion-productos-store'

export function BulkBarProductos() {
  const cantidad = useSeleccionCantidad()
  const limpiar = useSeleccionStore((s) => s.limpiar)
  if (cantidad === 0) return null

  return (
    <div
      role="region"
      aria-label="Acciones masivas"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-elev-3 enter-up"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={limpiar}
        aria-label="Limpiar selección"
      >
        <X className="size-3.5" />
      </Button>
      <span className="text-sm font-medium">
        <span className="font-numeric tabular-nums">{cantidad}</span>{' '}
        {cantidad === 1 ? 'seleccionado' : 'seleccionados'}
      </span>
    </div>
  )
}
