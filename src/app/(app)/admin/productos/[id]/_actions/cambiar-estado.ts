'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

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
    if (user.rol === 'vendedor') {
      return {
        ok: false,
        error: 'No tenés permisos para modificar productos',
      }
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('productos')
      .update({ activo: nuevoEstado })
      .eq('id', productoId)

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