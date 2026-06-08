'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { validarEliminarProductoInput } from '../../_lib/eliminar-producto-validacion'

export type EliminarProductoResult =
  | { ok: true; modo: 'hard' | 'soft'; ventas: number; operacion_id: string }
  | { ok: false; error: string }

/**
 * Elimina un producto del catálogo con razón obligatoria.
 * La RPC `eliminar_producto` (mig 026) decide hard/soft delete según el
 * producto tenga ventas asociadas, y registra audit en operaciones_masivas.
 * Solo admin/superadmin.
 */
export async function eliminarProducto(input: {
  productoId: string
  razon: string
}): Promise<EliminarProductoResult> {
  // 1. Auth
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { ok: false, error: 'No autenticado' }
  if (!puedeEditarCatalogo(user.rol)) {
    return { ok: false, error: 'No autorizado' }
  }

  // 2. Validar input (puro, testeable aparte)
  const validado = validarEliminarProductoInput(input)
  if (!validado.ok) return { ok: false, error: validado.error }

  // 3. RPC (decide hard/soft + audit; defense in depth: re-chequea auth/empresa)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('eliminar_producto', {
    p_usuario_id: user.id,
    p_id: validado.productoId,
    p_razon: validado.razon,
  })

  if (error) {
    console.error('[eliminarProducto]', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { ok: false, error: 'Error al eliminar el producto' }
  }

  // 4. Revalidate
  revalidatePath('/admin/productos')
  revalidatePath(`/admin/productos/${input.productoId}`)
  revalidatePath('/admin/operaciones')

  // 5. Parse response del RPC. Desde mig 029 el RPC puede devolver un shape de
  // rechazo {ok:false, error} (p. ej. el producto es componente de un combo
  // activo), además del shape de éxito {ok:true, modo, ventas, operacion_id}.
  const result = data as {
    ok: boolean
    error?: string
    modo?: 'hard' | 'soft'
    ventas?: number
    operacion_id?: string
  }
  if (result.ok === false) {
    return { ok: false, error: result.error ?? 'No se pudo eliminar el producto' }
  }
  return {
    ok: true,
    modo: result.modo!,
    ventas: result.ventas!,
    operacion_id: result.operacion_id!,
  }
}
