'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ActualizarPrecioResult =
  | { ok: true }
  | { ok: false; error: string }

export async function actualizarPrecio(
  productoId: string,
  precio: number
): Promise<ActualizarPrecioResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos para modificar precios' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    if (typeof productoId !== 'string' || !UUID_RE.test(productoId)) {
      return { ok: false, error: 'ID de producto inválido' }
    }
    if (typeof precio !== 'number' || precio < 0 || !Number.isFinite(precio)) {
      return { ok: false, error: 'Precio debe ser un número >= 0' }
    }

    const precioRedondeado = Math.round(precio * 100) / 100

    const supabase = await createClient()
    // Defense in depth sobre RLS: además del id, scopea por empresa.
    const { error } = await supabase
      .from('productos')
      .update({ precio_neto: precioRedondeado })
      .eq('id', productoId)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[actualizarPrecio] Error:', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos/${productoId}`)

    return { ok: true }
  } catch (error) {
    console.error('[actualizarPrecio] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
