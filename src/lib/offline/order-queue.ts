// src/lib/offline/order-queue.ts
//
// Operaciones sobre la cola de pedidos offline (tabla colaPedidos en IndexedDB).

import { db, type PedidoEnCola } from './db'

export type PayloadPedidoOffline = {
  clienteId: string | null
  /**
   * Nombre alternativo del cliente. Persiste en ventas.nombre_cliente_custom
   * cuando se sincroniza al server.
   */
  nombreClienteCustom?: string
  items: Array<{
    varianteId: string
    productoNombre: string
    productoSku: string
    skuVariante: string
    /**
     * Snapshot de atributos de la variante. Generaliza el viejo par
     * (color, talle) del proyecto Loom Point en un jsonb arbitrario.
     */
    atributos: Record<string, string>
    cantidad: number
    precioUnitarioNeto: number
  }>
  notaInterna?: string
  canal?: string
  usuarioId: string
}

export async function enqueuePedidoOffline(
  payload: PayloadPedidoOffline
): Promise<string> {
  const localId = crypto.randomUUID()
  const now = Date.now()

  const entry: PedidoEnCola = {
    localId,
    estado: 'pendiente',
    created_at: now,
    payload: {
      cliente_id: payload.clienteId,
      nombre_cliente_custom: payload.nombreClienteCustom ?? null,
      nota_para_admin: payload.notaInterna ?? null,
      usuario_id: payload.usuarioId,
      items: payload.items.map((i) => ({
        variante_id: i.varianteId,
        cantidad: i.cantidad,
        precio_unitario_neto: i.precioUnitarioNeto,
      })),
    },
  }

  const fullEntry = {
    ...entry,
    payload: {
      ...entry.payload,
      _extras: {
        canal: payload.canal ?? 'mostrador',
        items_full: payload.items,
      },
    },
  }

  try {
    await db.colaPedidos.put(fullEntry as PedidoEnCola)
    return localId
  } catch (err) {
    console.error('[order-queue] Error encolando pedido', err)
    throw new Error('No se pudo guardar el pedido offline')
  }
}

export async function getPedidosPendientes(): Promise<PedidoEnCola[]> {
  try {
    const pendientes = await db.colaPedidos
      .where('estado')
      .equals('pendiente')
      .toArray()
    pendientes.sort((a, b) => a.created_at - b.created_at)
    return pendientes
  } catch (err) {
    console.error('[order-queue] Error leyendo pendientes', err)
    return []
  }
}

export async function countPedidosPendientes(): Promise<number> {
  try {
    return await db.colaPedidos.where('estado').equals('pendiente').count()
  } catch (err) {
    console.error('[order-queue] Error contando pendientes', err)
    return 0
  }
}

export async function markSincronizando(localId: string): Promise<void> {
  try {
    await db.colaPedidos.update(localId, { estado: 'sincronizando' })
  } catch (err) {
    console.error('[order-queue] Error marcando sincronizando', err)
  }
}

export async function markSincronizado(
  localId: string,
  numeroServer: number
): Promise<void> {
  try {
    await db.colaPedidos.update(localId, {
      estado: 'sincronizado',
      numeroServer,
      synced_at: Date.now(),
    })
  } catch (err) {
    console.error('[order-queue] Error marcando sincronizado', err)
  }
}

export async function markError(
  localId: string,
  errorMensaje: string
): Promise<void> {
  try {
    await db.colaPedidos.update(localId, {
      estado: 'error',
      errorMensaje,
    })
  } catch (err) {
    console.error('[order-queue] Error marcando error', err)
  }
}

export async function resetSincronizando(): Promise<void> {
  try {
    await db.colaPedidos
      .where('estado')
      .equals('sincronizando')
      .modify({ estado: 'pendiente' })
  } catch (err) {
    console.error('[order-queue] Error reseteando sincronizando', err)
  }
}