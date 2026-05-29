'use client'

import { Checkbox } from '@/components/ui/checkbox'
import {
  useSeleccionStore,
  useEstadoPagina,
} from '../_state/seleccion-productos-store'

export function SeleccionHeaderCheckbox({ paginaIds }: { paginaIds: string[] }) {
  const estado = useEstadoPagina(paginaIds)
  const setPagina = useSeleccionStore((s) => s.setPagina)

  return (
    <Checkbox
      checked={estado === 'parcial' ? 'indeterminate' : estado === 'todos'}
      onCheckedChange={() => setPagina(paginaIds, estado !== 'todos')}
      aria-label="Seleccionar todos en esta página"
    />
  )
}
