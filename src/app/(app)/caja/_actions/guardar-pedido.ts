// src/app/(app)/caja/_actions/guardar-pedido.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import type { ItemVentaInput } from './cerrar-venta'

export type GuardarPedidoInput = {
  clienteId: string | null
  /**
   * Nombre alternativo del cliente para identificar el pedido.
   * Útil cuando el cliente no está en la base o se quiere usar un alias
   * (ej: "TOMAS BENZ #32009"). Persiste en ventas.nombre_cliente_custom.
   */
  nombreClienteCustom?: string
  canal?: string
  items: ItemVentaInput[]
  notaInterna?: string
}

export type GuardarPedidoResult =
  | { ok: true; ventaId: string; numero: number; subtotalNeto: number }
  | { ok: false; error: string }

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

export async function guardarPedido(
  input: GuardarPedidoInput
): Promise<GuardarPedidoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }

    if (!input.items || input.items.length === 0) {
      return { ok: false, error: 'El pedido no tiene items' }
    }

    for (const item of input.items) {
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        return {
          ok: false,
          error: `Cantidad inválida para ${item.productoNombre}`,
        }
      }
      if (item.precioUnitarioNeto < 0) {
        return {
          ok: false,
          error: `Precio inválido para ${item.productoNombre}`,
        }
      }
    }

    const itemsRpc = input.items.map((i) => ({
      variante_id: i.varianteId,
      producto_nombre: i.productoNombre,
      producto_sku: i.productoSku,
      variante_sku: i.skuVariante,
      variante_atributos: i.atributos,
      cantidad: i.cantidad,
      precio_unitario_neto: i.precioUnitarioNeto,
      subtotal_neto: redondear(i.precioUnitarioNeto * i.cantidad),
    }))

    const supabase = await createClient()

    const nombreCustomClean =
      input.nombreClienteCustom?.trim() || null

    const { data, error } = await supabase.rpc('guardar_pedido', {
      p_usuario_id: user.id,
      p_cliente_id: input.clienteId,
      p_canal: input.canal ?? 'mostrador',
      p_items: itemsRpc,
      p_nota_interna: input.notaInterna ?? null,
      p_nombre_cliente_custom: nombreCustomClean,
    } as never)

    if (error) {
      console.error('[guardarPedido] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al guardar el pedido',
      }
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Respuesta inválida del servidor' }
    }

    const result = data as {
      ok?: boolean
      venta_id?: string
      numero?: number
      subtotal_neto?: number
    }

    if (!result.ok || !result.venta_id) {
      return { ok: false, error: 'El pedido no pudo guardarse' }
    }

    revalidatePath('/caja')
    revalidatePath('/admin/pedidos')

    return {
      ok: true,
      ventaId: result.venta_id,
      numero: result.numero ?? 0,
      subtotalNeto: result.subtotal_neto ?? 0,
    }
  } catch (error) {
    console.error('[guardarPedido] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}