// src/lib/offline/sync-orders.ts
//
// Función que recorre la cola de pedidos pendientes y los envía al server.

import {
  getPedidosPendientes,
  markSincronizando,
  markSincronizado,
  markError,
} from './order-queue'
import type { PedidoEnCola } from './db'

let syncRunning = false

export type SyncOrdersResult = {
  attempted: number
  synced: number
  errors: number
  errorDetails: Array<{ localId: string; error: string }>
}

export async function syncOrdersFromQueue(): Promise<SyncOrdersResult> {
  if (syncRunning) {
    return { attempted: 0, synced: 0, errors: 0, errorDetails: [] }
  }

  syncRunning = true
  const result: SyncOrdersResult = {
    attempted: 0,
    synced: 0,
    errors: 0,
    errorDetails: [],
  }

  try {
    const pendientes = await getPedidosPendientes()
    if (pendientes.length === 0) return result

    for (const pedido of pendientes) {
      result.attempted += 1

      try {
        await markSincronizando(pedido.localId)

        const payload = buildSyncPayload(pedido)

        const response = await fetch('/api/sync/orders', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          let errorMsg = `Server respondió ${response.status}`
          try {
            const errorBody = await response.json()
            if (errorBody.error) errorMsg = errorBody.error
          } catch {
            // ignore
          }
          await markError(pedido.localId, errorMsg)
          result.errors += 1
          result.errorDetails.push({
            localId: pedido.localId,
            error: errorMsg,
          })
          continue
        }

        const data = (await response.json()) as {
          ok?: boolean
          numero?: number
        }

        if (data.ok && typeof data.numero === 'number') {
          await markSincronizado(pedido.localId, data.numero)
          result.synced += 1
        } else {
          await markError(pedido.localId, 'Respuesta del server sin numero')
          result.errors += 1
        }
      } catch {
        // Error de red: revertir a pendiente para retry
        await import('./order-queue').then((m) => m.resetSincronizando())
        break
      }
    }

    return result
  } finally {
    syncRunning = false
  }
}

/**
 * Convierte un PedidoEnCola al payload que espera /api/sync/orders.
 */
function buildSyncPayload(pedido: PedidoEnCola) {
  const extras = (pedido.payload as PedidoEnCola['payload'] & {
    _extras?: {
      canal: string
      items_full: Array<{
        varianteId: string
        productoNombre: string
        productoSku: string
        skuVariante: string
        color: string | null
        talle: string | null
        cantidad: number
        precioUnitarioNeto: number
      }>
    }
  })._extras

  if (!extras) {
    throw new Error('Pedido en cola sin _extras (formato viejo)')
  }

  return {
    localId: pedido.localId,
    clienteId: pedido.payload.cliente_id,
    // Pedidos creados antes de esta versión no tienen el campo:
    // si es undefined o falsy, mandamos null.
    nombreClienteCustom: pedido.payload.nombre_cliente_custom ?? null,
    notaInterna: pedido.payload.nota_para_admin,
    canal: extras.canal,
    items: extras.items_full,
    usuarioId: pedido.payload.usuario_id,
    createdAtLocal: pedido.created_at,
  }
}