'use client'

import { Checkbox } from '@/components/ui/checkbox'
import {
  useSeleccionStore,
  useSeleccionTiene,
} from '../_state/seleccion-productos-store'

export function FilaCheckbox({ id }: { id: string }) {
  const tiene = useSeleccionTiene(id)
  const toggle = useSeleccionStore((s) => s.toggle)
  return (
    <Checkbox
      checked={tiene}
      onCheckedChange={() => toggle(id)}
      aria-label="Seleccionar producto"
    />
  )
}
