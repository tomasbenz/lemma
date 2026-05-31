'use server'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  exportarProductosFilas,
  type ProductoFilaExport,
  type ListarProductosOptions,
} from '@/lib/queries/productos'

export type ExportarProductosResult =
  | { ok: true; filas: ProductoFilaExport[] }
  | { ok: false; error: string }

type Filtros = Pick<
  ListarProductosOptions,
  | 'busqueda'
  | 'soloActivos'
  | 'stockBajo'
  | 'marcaId'
  | 'categoriaId'
  | 'categoriaAsignada'
>

/**
 * Wrapper 'use server' de exportarProductosFilas. El cliente arma y descarga el
 * Excel con xlsx; el server solo provee las filas (RLS + empresa).
 */
export async function exportarProductosAccion(
  filtros: Filtros
): Promise<ExportarProductosResult> {
  try {
    // Export es read-only del catálogo que el usuario ya ve en el listado:
    // lo puede usar también la vendedora (botón visible para todos). La query
    // filtra por empresa_id (defense in depth).
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    const filas = await exportarProductosFilas(filtros)
    return { ok: true, filas }
  } catch (err) {
    console.error('[exportarProductosAccion]', err)
    return { ok: false, error: 'No se pudo exportar' }
  }
}
