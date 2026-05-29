/**
 * Store de selección masiva de productos (Zustand).
 *
 * Mantiene el conjunto de ids seleccionados FUERA del árbol de componentes, así
 * la selección sobrevive a los cambios de página del listado (que pagina en el
 * server). Es el primer store Zustand del proyecto.
 *
 * Los hooks expuestos devuelven SIEMPRE un primitivo (boolean/number/string)
 * derivado del Set, no el Set en sí. Esto evita que un cambio en el Set
 * re-renderice toda la tabla: cada fila se suscribe solo a `has(id)` y el
 * contador solo a `size`, de modo que React re-renderiza únicamente lo que
 * cruzó una frontera de estado.
 *
 * La selección es efímera: no se persiste en localStorage (no debe sobrevivir
 * a un refresh). El reset al cambiar filtros lo dispara ProductosView.
 */
import { create } from 'zustand'

type SeleccionState = {
  ids: Set<string>
  toggle: (id: string) => void
  setPagina: (ids: string[], seleccionar: boolean) => void
  agregarMuchos: (ids: string[]) => void
  limpiar: () => void
}

export const useSeleccionStore = create<SeleccionState>((set) => ({
  ids: new Set(),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ids: next }
    }),
  setPagina: (ids, seleccionar) =>
    set((s) => {
      const next = new Set(s.ids)
      if (seleccionar) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return { ids: next }
    }),
  agregarMuchos: (ids) =>
    set((s) => {
      const next = new Set(s.ids)
      ids.forEach((id) => next.add(id))
      return { ids: next }
    }),
  limpiar: () => set({ ids: new Set() }),
}))

// Hooks granulares: cada uno devuelve un primitivo para que el componente
// re-renderice solo cuando ESE primitivo cambia (no cuando cambia el Set entero).
export const useSeleccionTiene = (id: string): boolean =>
  useSeleccionStore((s) => s.ids.has(id))

export const useSeleccionCantidad = (): number =>
  useSeleccionStore((s) => s.ids.size)

// Header tri-state: devuelve 'vacio' | 'parcial' | 'todos' según cuántos
// ids de la página actual están en el Set. Usa selector primitivo (string)
// así el header solo re-renderiza al cruzar una frontera de estado.
export type EstadoPagina = 'vacio' | 'parcial' | 'todos'
export const useEstadoPagina = (paginaIds: string[]): EstadoPagina =>
  useSeleccionStore((s) => {
    if (paginaIds.length === 0) return 'vacio'
    let n = 0
    for (const id of paginaIds) if (s.ids.has(id)) n++
    if (n === 0) return 'vacio'
    if (n === paginaIds.length) return 'todos'
    return 'parcial'
  })
