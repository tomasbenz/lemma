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

    // Pre-check D3 (mig 029): no se puede desactivar un producto que es
    // componente de un combo activo. El trigger T4 igual bloquea el UPDATE,
    // pero acá damos el mensaje claro sin depender del texto crudo de Postgres.
    if (nuevoEstado === false) {
      const { data: comboMatch } = await supabase
        .from('combo_componentes')
        .select(
          'combo:productos!combo_componentes_combo_id_fkey!inner(nombre, activo)'
        )
        .eq('componente_producto_id', productoId)
        .eq('empresa_id', user.empresa_id)
        .eq('combo.activo', true)
        .limit(1)
        .maybeSingle()

      if (comboMatch) {
        const comboRel = comboMatch.combo as
          | { nombre: string }
          | { nombre: string }[]
          | null
        const nombre = Array.isArray(comboRel)
          ? comboRel[0]?.nombre
          : comboRel?.nombre
        return {
          ok: false,
          error: `No se puede desactivar este producto porque es componente del combo "${nombre ?? '—'}". Eliminá o desarmá el combo primero.`,
        }
      }
    }

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