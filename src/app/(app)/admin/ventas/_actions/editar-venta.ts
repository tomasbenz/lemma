// src/app/(app)/admin/ventas/_actions/editar-venta.ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type EditarVentaItem = {
  varianteId: string
  productoNombre: string
  productoSku: string
  varianteSku: string
  varianteAtributos: Record<string, string>
  cantidad: number
  precioUnitarioNeto: number
}

export type EditarVentaInput = {
  ventaId: string
  items: EditarVentaItem[]
}

export type EditarVentaResult =
  | {
      ok: true
      subtotalNeto: number
      total: number
      cantidadItems: number
      stockAjustesCount: number
      teniaFactura: boolean
    }
  | { ok: false; error: string }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function editarVenta(
  input: EditarVentaInput
): Promise<EditarVentaResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'No tenes permisos para editar ventas' }
    }

    if (!input.ventaId) {
      return { ok: false, error: 'ID de venta invalido' }
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: 'La venta debe tener al menos un item' }
    }

    for (const it of input.items) {
      if (!it.varianteId) {
        return { ok: false, error: 'Item invalido: falta varianteId' }
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

    if (!user.empresa_id) {
      return { ok: false, error: 'La venta no existe' }
    }

    const supabase = await createClient()

    const { data: venta } = await supabase
      .from('ventas')
      .select('id, estado')
      .eq('id', input.ventaId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (!venta) {
      return { ok: false, error: 'La venta no existe' }
    }

    if (venta.estado !== 'cerrada') {
      return { ok: false, error: 'Solo se pueden editar ventas cerradas' }
    }

    const headersList = await headers()
    const ip =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      null
    const userAgent = headersList.get('user-agent') ?? null

    const itemsRpc = input.items.map((it) => {
      const subtotalNeto = round2(it.cantidad * it.precioUnitarioNeto)
      return {
        variante_id: it.varianteId,
        producto_nombre: it.productoNombre,
        producto_sku: it.productoSku,
        variante_sku: it.varianteSku,
        variante_atributos: it.varianteAtributos,
        cantidad: it.cantidad,
        precio_unitario_neto: round2(it.precioUnitarioNeto),
        subtotal_neto: subtotalNeto,
      }
    })

    const { data, error } = await supabase.rpc('editar_venta', {
      p_venta_id: input.ventaId,
      p_usuario_id: user.id,
      p_items_nuevos: itemsRpc,
      p_ip: ip,
      p_user_agent: userAgent,
    } as never)

    if (error) {
      console.error('[editarVenta] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al editar la venta',
      }
    }

    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Respuesta invalida del servidor' }
    }

    const result = data as {
      ok?: boolean
      subtotal_neto?: number
      total?: number
      cantidad_items?: number
      stock_ajustes_count?: number
      tenia_factura?: boolean
    }

    if (!result.ok) {
      return { ok: false, error: 'La venta no pudo editarse' }
    }

    revalidatePath('/admin/ventas')
    revalidatePath(`/admin/ventas/${input.ventaId}`)

    return {
      ok: true,
      subtotalNeto: result.subtotal_neto ?? 0,
      total: result.total ?? 0,
      cantidadItems: result.cantidad_items ?? input.items.length,
      stockAjustesCount: result.stock_ajustes_count ?? 0,
      teniaFactura: result.tenia_factura ?? false,
    }
  } catch (error) {
    console.error('[editarVenta] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}
