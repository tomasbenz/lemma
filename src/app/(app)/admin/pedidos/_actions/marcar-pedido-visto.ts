// src/app/(app)/admin/pedidos/_actions/marcar-pedido-visto.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

/**
 * Marca un pedido como visto por el admin (setea vista_at = now()).
 * Idempotente: si ya estaba visto, no hace nada.
 */
export async function marcarPedidoVisto(
  pedidoId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'No autorizado' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'No autorizado' }
    }

    const supabase = await createClient()

    const { error } = await supabase
      .from('ventas')
      .update({ vista_at: new Date().toISOString() })
      .eq('id', pedidoId)
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'guardada')
      .is('vista_at', null)

    if (error) {
      console.error('[marcarPedidoVisto] Error:', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin')
    revalidatePath('/admin/pedidos')

    return { ok: true }
  } catch (error) {
    console.error('[marcarPedidoVisto] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}

/**
 * Marca todos los pedidos pendientes como vistos.
 * Útil cuando el admin entra y quiere "limpiar la bandeja" rápido.
 */
export async function marcarTodosPedidosVistos(): Promise<{
  ok: boolean
  cantidad?: number
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'No autorizado' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'No autorizado' }
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ventas')
      .update({ vista_at: new Date().toISOString() })
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'guardada')
      .is('vista_at', null)
      .select('id')

    if (error) {
      console.error('[marcarTodosPedidosVistos] Error:', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin')
    revalidatePath('/admin/pedidos')

    return { ok: true, cantidad: data?.length ?? 0 }
  } catch (error) {
    console.error('[marcarTodosPedidosVistos] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}