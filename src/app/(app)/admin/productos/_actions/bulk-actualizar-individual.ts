'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito } from '@/lib/cobro/calculos'
import {
  obtenerProductosParaPreview,
  type ProductoPreview,
} from '@/lib/queries/productos'

const CAP = 1000

export type ObtenerPreviewResult =
  | { ok: true; productos: ProductoPreview[] }
  | { ok: false; error: string }

/**
 * Wrapper 'use server' de obtenerProductosParaPreview, para invocarlo desde el
 * client (la barra abre la preview con datos frescos: la selección puede incluir
 * ids de páginas no cargadas por el listado).
 */
export async function obtenerPreviewProductos(
  ids: string[]
): Promise<ObtenerPreviewResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    const productos = await obtenerProductosParaPreview(ids)
    return { ok: true, productos }
  } catch (err) {
    console.error('[obtenerPreviewProductos]', err)
    return { ok: false, error: 'No se pudieron cargar los productos' }
  }
}

export type BulkIndividualInput =
  | { accion: 'precio_individual'; cambios: { id: string; precio: number }[] }
  | {
      accion: 'stock_individual'
      motivo: string
      cambios: { id: string; stock: number }[]
    }

export type BulkIndividualResult =
  | {
      ok: true
      afectados: number
      totalSolicitados: number
      omitidos: { id: string; motivo: string }[]
    }
  | { ok: false; error: string }

/**
 * Aplica valores INDIVIDUALES por producto (Fase 2 de acciones masivas, preview
 * editable). Cada producto trae su valor final concreto, no una regla.
 *
 * Despacha a una de las dos RPCs atómicas (migración 008):
 *   - productos_bulk_precio_individual  (precio final por producto)
 *   - productos_bulk_stock_individual   (stock absoluto final + motivo de lote)
 *
 * La validación client-side es defense in depth: la RPC valida igual.
 */
export async function bulkActualizarProductosIndividual(
  input: BulkIndividualInput
): Promise<BulkIndividualResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'Sesión inválida' }
    }

    const { cambios } = input
    if (!Array.isArray(cambios) || cambios.length === 0) {
      return { ok: false, error: 'No hay cambios para aplicar' }
    }
    if (cambios.length > CAP) {
      return { ok: false, error: 'Máximo 1000 productos por operación' }
    }
    if (cambios.some((c) => typeof c.id !== 'string' || c.id.length === 0)) {
      return { ok: false, error: 'Hay ids de producto inválidos' }
    }

    const supabase = await createClient()

    let data: unknown
    let rpcError: { message: string } | null = null

    if (input.accion === 'precio_individual') {
      if (input.cambios.some((c) => !esMontoFinito(c.precio) || c.precio <= 0)) {
        return { ok: false, error: 'Hay precios inválidos' }
      }
      const res = await supabase.rpc('productos_bulk_precio_individual', {
        p_usuario_id: user.id,
        p_cambios: input.cambios,
      })
      data = res.data
      rpcError = res.error
    } else {
      if (typeof input.motivo !== 'string' || input.motivo.trim().length < 3) {
        return { ok: false, error: 'El motivo es obligatorio (mín. 3 caracteres)' }
      }
      if (
        input.cambios.some(
          (c) => !Number.isInteger(c.stock) || c.stock < 0
        )
      ) {
        return { ok: false, error: 'Hay valores de stock inválidos' }
      }
      const res = await supabase.rpc('productos_bulk_stock_individual', {
        p_usuario_id: user.id,
        p_motivo: input.motivo.trim(),
        p_cambios: input.cambios,
      })
      data = res.data
      rpcError = res.error
    }

    if (rpcError) {
      console.error('[bulkActualizarProductosIndividual] Error RPC:', rpcError)
      return { ok: false, error: rpcError.message || 'Error al aplicar los cambios' }
    }

    const r = data as {
      ok?: boolean
      afectados?: number
      total_solicitados?: number
      omitidos?: { id: string; motivo: string }[]
    }

    if (!r?.ok) {
      return { ok: false, error: 'No se pudieron aplicar los cambios' }
    }

    revalidatePath('/admin/productos')

    return {
      ok: true,
      afectados: r.afectados ?? 0,
      totalSolicitados: r.total_solicitados ?? input.cambios.length,
      omitidos: r.omitidos ?? [],
    }
  } catch (error) {
    console.error('[bulkActualizarProductosIndividual] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
