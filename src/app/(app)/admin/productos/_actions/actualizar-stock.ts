'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ActualizarStockInput = Array<{
  varianteId: string
  stock: number
}>

export type ActualizarStockResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Server Action: actualiza el stock de una o varias variantes en batch.
 *
 * - Valida que el usuario tenga permisos (admin/superadmin)
 * - Valida que todos los stocks sean enteros >= 0
 * - Hace los updates de forma secuencial (Supabase no soporta batch update en cliente JS)
 * - Revalida el listado y el detalle del producto afectado
 */
export async function actualizarStock(
  input: ActualizarStockInput
): Promise<ActualizarStockResult> {
  try {
    // Auth
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos para modificar stock' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    // Validar entrada
    if (!Array.isArray(input) || input.length === 0) {
      return { ok: false, error: 'No hay variantes para actualizar' }
    }
    for (const { varianteId, stock } of input) {
      if (typeof varianteId !== 'string' || !UUID_RE.test(varianteId)) {
        return { ok: false, error: 'ID de variante inválido' }
      }
      if (!Number.isInteger(stock) || stock < 0) {
        return { ok: false, error: 'Stock debe ser un entero mayor o igual a 0' }
      }
    }

    const supabase = await createClient()

    // Traer las variantes para saber a qué productos pertenecen (para revalidar).
    // Defense in depth sobre RLS: scopea por empresa.
    const varianteIds = input.map((v) => v.varianteId)
    const { data: variantes, error: errorFetch } = await supabase
      .from('variantes')
      .select('id, producto_id')
      .in('id', varianteIds)
      .eq('empresa_id', user.empresa_id)

    if (errorFetch) {
      console.error('[actualizarStock] Error fetch:', errorFetch)
      return { ok: false, error: errorFetch.message }
    }

    if (!variantes || variantes.length !== input.length) {
      return { ok: false, error: 'Alguna variante no fue encontrada' }
    }

    // Update secuencial (Supabase JS no soporta batch con valores distintos por fila)
    for (const { varianteId, stock } of input) {
      const { error } = await supabase
        .from('variantes')
        .update({ stock })
        .eq('id', varianteId)
        .eq('empresa_id', user.empresa_id)

      if (error) {
        console.error('[actualizarStock] Error update:', error)
        return {
          ok: false,
          error: 'Error actualizando stock: ' + error.message,
        }
      }
    }

    // Revalidar listado y detalles de cada producto afectado
    revalidatePath('/admin/productos')
    const productoIds = [...new Set(variantes.map((v) => v.producto_id))]
    for (const pid of productoIds) {
      revalidatePath(`/admin/productos/${pid}`)
    }

    return { ok: true }
  } catch (error) {
    console.error('[actualizarStock] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}