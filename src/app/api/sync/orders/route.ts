// src/app/api/sync/orders/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { esMontoFinito } from '@/lib/cobro/calculos'

type ItemPayload = {
  varianteId: string
  productoNombre: string
  productoSku: string
  skuVariante: string
  /**
   * Atributos snapshot al momento de armar el pedido offline. Generaliza
   * el viejo par (color, talle) de Loom Point en un jsonb arbitrario.
   * Vacío {} si la variante no tenía atributos (caso DEFAULT).
   */
  atributos: Record<string, string>
  cantidad: number
  precioUnitarioNeto: number
}

type SyncOrderPayload = {
  localId: string
  clienteId: string | null
  /** Nombre alternativo del cliente, opcional. */
  nombreClienteCustom?: string | null
  notaInterna: string | null
  canal: string
  items: ItemPayload[]
  usuarioId: string
  createdAtLocal: number
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  let payload: SyncOrderPayload
  try {
    payload = (await request.json()) as SyncOrderPayload
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  if (!payload.localId || typeof payload.localId !== 'string') {
    return NextResponse.json(
      { error: 'localId requerido' },
      { status: 400 }
    )
  }

  if (!payload.items || payload.items.length === 0) {
    return NextResponse.json(
      { error: 'El pedido no tiene items' },
      { status: 400 }
    )
  }

  if (payload.usuarioId !== user.id) {
    return NextResponse.json(
      { error: 'usuario_id no coincide con la sesión' },
      { status: 403 }
    )
  }

  for (const item of payload.items) {
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      return NextResponse.json(
        { error: `Cantidad inválida para ${item.productoNombre}` },
        { status: 400 }
      )
    }
    if (!esMontoFinito(item.precioUnitarioNeto) || item.precioUnitarioNeto < 0) {
      return NextResponse.json(
        { error: `Precio inválido para ${item.productoNombre}` },
        { status: 400 }
      )
    }
  }

  const itemsRpc = payload.items.map((i) => ({
    variante_id: i.varianteId,
    producto_nombre: i.productoNombre,
    producto_sku: i.productoSku,
    variante_sku: i.skuVariante,
    variante_atributos: i.atributos,
    cantidad: i.cantidad,
    precio_unitario_neto: i.precioUnitarioNeto,
    subtotal_neto: redondear(i.precioUnitarioNeto * i.cantidad),
  }))

  // Marker de offline en la nota para auditoría
  const fechaLocal = new Date(payload.createdAtLocal)
  const fechaTexto = fechaLocal.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const notaConMeta = payload.notaInterna
    ? `${payload.notaInterna}\n\n[Pedido armado offline el ${fechaTexto}]`
    : `[Pedido armado offline el ${fechaTexto}]`

  const nombreCustomClean =
    payload.nombreClienteCustom?.trim() || null

  try {
    const supabase = await createClient()

    const { data, error } = await supabase.rpc('guardar_pedido', {
      p_usuario_id: user.id,
      p_cliente_id: payload.clienteId,
      p_canal: payload.canal,
      p_items: itemsRpc,
      p_nota_interna: notaConMeta,
      p_nombre_cliente_custom: nombreCustomClean,
    } as never)

    if (error) {
      console.error('[/api/sync/orders] Error RPC:', error)
      return NextResponse.json(
        { error: error.message || 'Error al guardar el pedido' },
        { status: 500 }
      )
    }

    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { error: 'Respuesta inválida del RPC' },
        { status: 500 }
      )
    }

    const result = data as {
      ok?: boolean
      venta_id?: string
      numero?: number
    }

    if (!result.ok || !result.venta_id) {
      return NextResponse.json(
        { error: 'El pedido no pudo guardarse' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      localId: payload.localId,
      ventaId: result.venta_id,
      numero: result.numero ?? 0,
    })
  } catch (err) {
    console.error('[/api/sync/orders] Error inesperado:', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error inesperado',
      },
      { status: 500 }
    )
  }
}