// src/app/(app)/admin/pedidos/_actions/editar-pedido.ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeGestionarPedido } from '@/lib/auth/permisos'

export type EditarPedidoItem = {
  varianteId: string
  productoNombre: string
  productoSku: string
  varianteSku: string
  varianteColor: string | null
  varianteTalle: string | null
  cantidad: number
  precioUnitarioNeto: number
}

export type EditarPedidoInput = {
  pedidoId: string
  items: EditarPedidoItem[]
}

export type EditarPedidoResult =
  | { ok: true; subtotalNeto: number; cantidadItems: number }
  | { ok: false; error: string }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function editarPedido(
  input: EditarPedidoInput
): Promise<EditarPedidoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }

    if (!input.pedidoId) {
      return { ok: false, error: 'ID de pedido inválido' }
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: 'El pedido debe tener al menos un item' }
    }

    for (const it of input.items) {
      if (!it.varianteId) {
        return { ok: false, error: 'Item inválido: falta varianteId' }
      }
      if (!Number.isFinite(it.cantidad) || it.cantidad <= 0) {
        return { ok: false, error: 'Cantidad debe ser mayor a cero' }
      }
      if (!Number.isFinite(it.precioUnitarioNeto) || it.precioUnitarioNeto < 0) {
        return {
          ok: false,
          error: 'Precio unitario debe ser mayor o igual a cero',
        }
      }
    }

    // Defense in depth sobre RLS: sin empresa_id no hay pedido consultable.
    if (!user.empresa_id) {
      return { ok: false, error: 'El pedido no se puede editar' }
    }

    const supabase = await createClient()

    // Pre-check: existe, está en guardada, y pertenece a la empresa del caller.
    // Tambien traemos usuario_id para ownership check (vendedora solo puede
    // editar pedidos propios).
    const { data: pedido } = await supabase
      .from('ventas')
      .select('id, estado, usuario_id')
      .eq('id', input.pedidoId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (!pedido || pedido.estado !== 'guardada') {
      return { ok: false, error: 'El pedido no se puede editar' }
    }

    if (!puedeGestionarPedido(user, pedido.usuario_id)) {
      return { ok: false, error: 'El pedido no se puede editar' }
    }

    // Headers para audit log
    const headersList = await headers()
    const ip =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      null
    const userAgent = headersList.get('user-agent') ?? null

    // Construir payload para la RPC con shape esperado.
    const itemsRpc = input.items.map((it) => {
      const subtotalNeto = round2(it.cantidad * it.precioUnitarioNeto)
      return {
        variante_id: it.varianteId,
        producto_nombre: it.productoNombre,
        producto_sku: it.productoSku,
        variante_sku: it.varianteSku,
        variante_color: it.varianteColor,
        variante_talle: it.varianteTalle,
        cantidad: it.cantidad,
        precio_unitario_neto: round2(it.precioUnitarioNeto),
        subtotal_neto: subtotalNeto,
      }
    })

    // Tipos generados de Supabase todavía no incluyen `editar_pedido`
    // (se regeneran con `npm run db:types` después de aplicar la migration).
    // Cast pragmático para que tsc compile sin tener que tocar database.ts.
    type RpcFn = (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{
      data: unknown
      error: { message: string } | null
    }>
    const rpc = supabase.rpc as unknown as RpcFn

    const { data, error } = await rpc('editar_pedido', {
      p_pedido_id: input.pedidoId,
      p_usuario_id: user.id,
      p_items_nuevos: itemsRpc,
      p_ip: ip,
      p_user_agent: userAgent,
    })

    if (error) {
      console.error('[editarPedido] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al editar el pedido',
      }
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Respuesta inválida del servidor' }
    }

    const result = data as {
      ok?: boolean
      subtotal_neto?: number
      cantidad_items?: number
    }

    if (!result.ok) {
      return { ok: false, error: 'El pedido no pudo editarse' }
    }

    revalidatePath('/admin/pedidos')
    revalidatePath(`/admin/pedidos/${input.pedidoId}`)

    return {
      ok: true,
      subtotalNeto: result.subtotal_neto ?? 0,
      cantidadItems: result.cantidad_items ?? input.items.length,
    }
  } catch (error) {
    console.error('[editarPedido] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}
