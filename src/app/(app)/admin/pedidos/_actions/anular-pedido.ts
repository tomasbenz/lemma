// src/app/(app)/admin/pedidos/_actions/anular-pedido.ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeGestionarPedido } from '@/lib/auth/permisos'

export type AnularPedidoResult =
  | { ok: true; numero: number }
  | { ok: false; error: string }

export async function anularPedido(
  pedidoId: string,
  motivo: string
): Promise<AnularPedidoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }

    if (!pedidoId) {
      return { ok: false, error: 'ID de pedido inválido' }
    }

    const motivoLimpio = motivo?.trim() ?? ''
    if (!motivoLimpio) {
      return { ok: false, error: 'El motivo es obligatorio' }
    }

    // Defense in depth sobre RLS: sin empresa_id no hay pedido consultable.
    // Los pedidos viven en la tabla `ventas` con estado='guardada'.
    if (!user.empresa_id) {
      return { ok: false, error: 'El pedido no existe' }
    }

    // Capturar IP y user agent para audit log
    const headersList = await headers()
    const ip =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      null
    const userAgent = headersList.get('user-agent') ?? null

    const supabase = await createClient()

    const { data: existe } = await supabase
      .from('ventas')
      .select('id, usuario_id, estado')
      .eq('id', pedidoId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (!existe) {
      return { ok: false, error: 'El pedido no existe' }
    }

    if (!puedeGestionarPedido(user, existe.usuario_id)) {
      // Mismo mensaje generico que "no existe" — no filtra ownership.
      return { ok: false, error: 'El pedido no existe' }
    }

    const { data, error } = await supabase.rpc('anular_pedido', {
      p_pedido_id: pedidoId,
      p_motivo: motivoLimpio,
      p_ip: ip,
      p_user_agent: userAgent,
    } as never)

    if (error) {
      console.error('[anularPedido] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al anular el pedido',
      }
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Respuesta inválida del servidor' }
    }

    const result = data as {
      ok?: boolean
      venta_id?: string
      numero?: number
    }

    if (!result.ok) {
      return { ok: false, error: 'El pedido no pudo anularse' }
    }

    revalidatePath('/admin/pedidos')
    return {
      ok: true,
      numero: result.numero ?? 0,
    }
  } catch (error) {
    console.error('[anularPedido] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}