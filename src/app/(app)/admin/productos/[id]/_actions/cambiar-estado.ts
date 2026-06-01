'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CambiarEstadoResult =
  | { ok: true; activo: boolean }
  | { ok: false; error: string }

/**
 * Activa o desactiva un producto (soft delete).
 * Solo admin/superadmin.
 */
export async function cambiarEstadoProducto(
  productoId: string,
  nuevoEstado: boolean
): Promise<CambiarEstadoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { ok: false, error: 'No autenticado' }
    }
    if (!puedeEditarCatalogo(user.rol)) {
      return {
        ok: false,
        error: 'No tenés permisos para modificar productos',
      }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }
    if (typeof productoId !== 'string' || !UUID_RE.test(productoId)) {
      return { ok: false, error: 'ID de producto inválido' }
    }

    const supabase = await createClient()
    // Defense in depth sobre RLS: además del id, scopea por empresa.
    const { error } = await supabase
      .from('productos')
      .update({ activo: nuevoEstado })
      .eq('id', productoId)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[cambiarEstadoProducto] Error:', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos/${productoId}`)

    return { ok: true, activo: nuevoEstado }
  } catch (error) {
    console.error('[cambiarEstadoProducto] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}