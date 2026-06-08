'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { validarCambiarPrecioInput } from '../_lib/cambiar-precio-validacion'

export type CambiarPrecioResult =
  | { ok: true; precioAnterior: number; precioNuevo: number; operacionId: string }
  | { ok: false; error: string }

/**
 * Cambia el precio de un producto desde la caja. Persiste al catálogo y audita
 * en operaciones_masivas vía la RPC cambiar_precio_producto_caja (mig 027).
 *
 * Permisos: cualquier usuario con acceso a caja (NO se exige admin — decisión
 * de Samu, mitigada por el audit). La RPC re-chequea auth/empresa server-side.
 */
export async function cambiarPrecioCaja(input: {
  productoId: string
  precioNuevo: number
  razon: string // string vacío si no se dio razón
}): Promise<CambiarPrecioResult> {
  // Auth (cualquier usuario con caja; no se chequea puedeEditarCatalogo)
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { ok: false, error: 'No autenticado' }

  const validado = validarCambiarPrecioInput(input)
  if (!validado.ok) return { ok: false, error: validado.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cambiar_precio_producto_caja', {
    p_usuario_id: user.id,
    p_producto_id: validado.productoId,
    p_precio_nuevo: validado.precioNuevo,
    p_razon: validado.razon ?? '', // la RPC trimea y null-ifica
    // p_venta_id se omite (DEFAULT NULL): el carrito vive en localStorage y la
    // fila en ventas recién existe al cerrar la venta.
  })

  if (error) {
    console.error('[cambiarPrecioCaja]', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { ok: false, error: 'Error al cambiar el precio' }
  }

  revalidatePath('/admin/operaciones')
  revalidatePath('/admin/productos')
  revalidatePath(`/admin/productos/${validado.productoId}`)

  const result = data as {
    ok: boolean
    precio_anterior: number
    precio_nuevo: number
    operacion_id: string
  }
  return {
    ok: true,
    precioAnterior: result.precio_anterior,
    precioNuevo: result.precio_nuevo,
    operacionId: result.operacion_id,
  }
}
