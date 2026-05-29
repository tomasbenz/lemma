'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito } from '@/lib/cobro/calculos'

const CAP = 1000

export type BulkActualizarInput =
  | { accion: 'precio_pct'; ids: string[]; pct: number }
  | { accion: 'precio_fijo'; ids: string[]; precio: number }
  | { accion: 'cambiar_categoria'; ids: string[]; categoria: string | null }
  | { accion: 'cambiar_activo'; ids: string[]; activo: boolean }
  | { accion: 'stock_sumar'; ids: string[]; valor: number; motivo: string }
  | { accion: 'stock_restar'; ids: string[]; valor: number; motivo: string }
  | { accion: 'stock_fijar'; ids: string[]; valor: number; motivo: string }

export type BulkActualizarResult =
  | {
      ok: true
      afectados: number
      totalSolicitados: number
      omitidos: { id: string; motivo: string }[]
    }
  | { ok: false; error: string }

/**
 * Aplica una acción masiva sobre un conjunto de productos.
 *
 * Despacha a una de las dos RPCs atómicas (migración 007):
 *   - productos_bulk_update  → precio_pct, precio_fijo, cambiar_categoria, cambiar_activo
 *   - productos_bulk_stock   → stock_sumar / stock_restar / stock_fijar
 *
 * Decisiones (ver migración 007):
 *   - Cap 1000 productos por operación (se valida acá y en la RPC).
 *   - Atómica: la RPC hace todo o nada (RAISE = rollback).
 *   - Stock: solo productos con 1 variante activa; los multi-variante (y sin
 *     stock / negativos) se devuelven en `omitidos`, no se tocan.
 *
 * La validación client-side es defense in depth: la RPC valida igual, pero acá
 * cortamos lo obviamente inválido para ahorrar el roundtrip.
 */
export async function bulkActualizarProductos(
  input: BulkActualizarInput
): Promise<BulkActualizarResult> {
  try {
    // ===== Auth + permisos =====
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }

    // puedeEditarCatalogo = admin/superadmin. Es el permiso correcto para el
    // bulk (flujo de ABM de catálogo), NO el de stock singular (puedeAjustarStock,
    // que además permite vendedora). El bulk siempre es admin.
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'Sesión inválida' }
    }

    // ===== Validación de ids =====
    const { ids } = input
    if (!Array.isArray(ids) || ids.length === 0) {
      return { ok: false, error: 'No hay productos seleccionados' }
    }
    if (ids.some((id) => typeof id !== 'string' || id.length === 0)) {
      return { ok: false, error: 'Hay ids de producto inválidos' }
    }
    if (ids.length > CAP) {
      return { ok: false, error: 'Máximo 1000 productos por operación' }
    }

    const supabase = await createClient()

    // ===== Validación por acción + invocación de la RPC =====
    let data: unknown
    let rpcError: { message: string } | null = null

    if (
      input.accion === 'precio_pct' ||
      input.accion === 'precio_fijo' ||
      input.accion === 'cambiar_categoria' ||
      input.accion === 'cambiar_activo'
    ) {
      let params: Record<string, string | number | boolean | null>

      switch (input.accion) {
        case 'precio_pct':
          if (!esMontoFinito(input.pct) || input.pct < -100) {
            return { ok: false, error: 'Porcentaje inválido' }
          }
          params = { pct: input.pct }
          break
        case 'precio_fijo':
          if (!esMontoFinito(input.precio) || input.precio <= 0) {
            return { ok: false, error: 'El precio debe ser mayor a 0' }
          }
          params = { precio: input.precio }
          break
        case 'cambiar_categoria':
          if (
            input.categoria !== null &&
            (typeof input.categoria !== 'string' || input.categoria.length > 100)
          ) {
            return { ok: false, error: 'Categoría inválida' }
          }
          params = { categoria: input.categoria }
          break
        case 'cambiar_activo':
          if (typeof input.activo !== 'boolean') {
            return { ok: false, error: 'Estado inválido' }
          }
          params = { activo: input.activo }
          break
      }

      const res = await supabase.rpc('productos_bulk_update', {
        p_usuario_id: user.id,
        p_accion: input.accion,
        p_ids: ids,
        p_params: params,
      })
      data = res.data
      rpcError = res.error
    } else {
      // Acciones de stock: stock_sumar | stock_restar | stock_fijar
      const modo =
        input.accion === 'stock_sumar'
          ? 'sumar'
          : input.accion === 'stock_restar'
            ? 'restar'
            : 'fijar'

      if (!Number.isInteger(input.valor)) {
        return { ok: false, error: 'El valor de stock debe ser un entero' }
      }
      if (modo === 'fijar' ? input.valor < 0 : input.valor <= 0) {
        return {
          ok: false,
          error:
            modo === 'fijar'
              ? 'El valor no puede ser negativo'
              : 'El valor debe ser mayor a 0',
        }
      }
      if (typeof input.motivo !== 'string' || input.motivo.trim().length < 3) {
        return { ok: false, error: 'El motivo es obligatorio (mín. 3 caracteres)' }
      }

      const res = await supabase.rpc('productos_bulk_stock', {
        p_usuario_id: user.id,
        p_modo: modo,
        p_valor: input.valor,
        p_motivo: input.motivo.trim(),
        p_ids: ids,
      })
      data = res.data
      rpcError = res.error
    }

    if (rpcError) {
      console.error('[bulkActualizarProductos] Error RPC:', rpcError)
      return { ok: false, error: rpcError.message || 'Error al aplicar la acción' }
    }

    // ===== Parseo defensivo del retorno =====
    const r = data as {
      ok?: boolean
      afectados?: number
      total_solicitados?: number
      omitidos?: { id: string; motivo: string }[]
    }

    if (!r?.ok) {
      return { ok: false, error: 'No se pudo aplicar la acción masiva' }
    }

    revalidatePath('/admin/productos')

    return {
      ok: true,
      afectados: r.afectados ?? 0,
      totalSolicitados: r.total_solicitados ?? ids.length,
      omitidos: r.omitidos ?? [],
    }
  } catch (error) {
    console.error('[bulkActualizarProductos] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
