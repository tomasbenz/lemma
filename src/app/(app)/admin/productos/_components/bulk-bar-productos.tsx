'use client'

import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useSeleccionStore,
  useSeleccionCantidad,
} from '../_state/seleccion-productos-store'
import { BulkAccionDialog } from './bulk-accion-dialog'
import type { BulkActualizarInput } from '../_actions/bulk-actualizar-productos'

type AccionAbierta = 'activar' | 'desactivar' | null

export function BulkBarProductos() {
  const cantidad = useSeleccionCantidad()
  const limpiar = useSeleccionStore((s) => s.limpiar)
  const [accion, setAccion] = useState<AccionAbierta>(null)

  if (cantidad === 0) return null

  // Builder lazy del input: se ejecuta dentro del handler del dialog, así
  // tomamos el snapshot fresco de la selección al confirmar.
  function buildInput(): BulkActualizarInput | null {
    if (!accion) return null
    const ids = Array.from(useSeleccionStore.getState().ids)
    if (ids.length === 0) return null
    return {
      accion: 'cambiar_activo',
      ids,
      activo: accion === 'activar',
    }
  }

  const tituloDialog =
    accion === 'activar'
      ? `¿Activar ${cantidad} producto${cantidad === 1 ? '' : 's'}?`
      : accion === 'desactivar'
        ? `¿Desactivar ${cantidad} producto${cantidad === 1 ? '' : 's'}?`
        : ''

  const descripcionDialog =
    accion === 'activar'
      ? 'Los productos vuelven a estar disponibles en la caja.'
      : accion === 'desactivar'
        ? 'Los productos dejan de aparecer en la caja. Podés volver a activarlos cuando quieras.'
        : undefined

  return (
    <>
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

        <div className="border-l pl-2 ml-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Acciones
                <ChevronDown className="size-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuItem onClick={() => setAccion('activar')}>
                Activar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAccion('desactivar')}>
                Desactivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <BulkAccionDialog
        open={accion !== null}
        onOpenChange={(open) => {
          if (!open) setAccion(null)
        }}
        buildInput={buildInput}
        titulo={tituloDialog}
        descripcion={descripcionDialog}
        confirmLabel={accion === 'desactivar' ? 'Desactivar' : 'Activar'}
        destructive={accion === 'desactivar'}
        onSuccess={limpiar}
      />
    </>
  )
}
