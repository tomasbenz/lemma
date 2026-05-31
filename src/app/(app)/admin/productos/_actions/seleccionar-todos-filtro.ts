'use server'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { listarProductoIdsPorFiltro } from '@/lib/queries/productos'

type Filtros = {
  busqueda?: string
  soloActivos?: boolean
  stockBajo?: boolean
  marcaId?: string
  categoriaId?: string
}

export type SeleccionarTodosResult =
  | { ok: true; ids: string[]; excedeCap: boolean }
  | { ok: false; error: string }

/**
 * Wrapper 'use server' de listarProductoIdsPorFiltro para poder invocarla desde
 * un client component (el banner de "seleccionar todos del filtro").
 */
export async function seleccionarTodosDelFiltro(
  filtros: Filtros
): Promise<SeleccionarTodosResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    const { ids, excedeCap } = await listarProductoIdsPorFiltro(filtros)
    return { ok: true, ids, excedeCap }
  } catch (err) {
    console.error('[seleccionarTodosDelFiltro]', err)
    return { ok: false, error: 'No se pudo obtener la selección' }
  }
}
