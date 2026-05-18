// src/lib/offline/sync-catalog.ts
//
// Función client-side que sincroniza el catálogo (productos + clientes)
// desde el server hacia IndexedDB.
//
// Estrategia: replace all. Cada sync borra la cache local y la repuebla
// con la data fresca del server. Para una librería típica (cientos a miles
// de productos) es trivial en performance (<200ms total).
//
// Errores: si el sync falla por cualquier razón (sin internet, server caído,
// 401), NO se borra la cache local. Mantenemos lo que teníamos antes.

import { db, setMeta, META_KEYS } from './db'
import type { ProductoCaja } from '@/lib/queries/productos-caja'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'

type SyncResponse = {
  productos: ProductoCaja[]
  clientes: ClienteCaja[]
  synced_at: number
}

export type SyncResult =
  | { ok: true; productosCount: number; clientesCount: number; syncedAt: number }
  | { ok: false; error: string }

/**
 * Hace el fetch al endpoint /api/sync/catalog y reemplaza la cache local
 * con la data fresca. Devuelve un resultado con el conteo o el error.
 *
 * Esta función es idempotente: llamarla varias veces no genera efectos
 * colaterales no deseados — siempre es replace all.
 */
export async function syncCatalogFromServer(
  userId: string
): Promise<SyncResult> {
  // 1. Pedir el catálogo al server
  let response: Response
  try {
    response = await fetch('/api/sync/catalog', {
      method: 'GET',
      credentials: 'same-origin', // mandar cookies para que la auth funcione
      cache: 'no-store',
    })
  } catch (err) {
    // Error de red (no hay internet, DNS falló, etc.)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red',
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Server respondió ${response.status}`,
    }
  }

  let data: SyncResponse
  try {
    data = (await response.json()) as SyncResponse
  } catch (_err) {
    return {
      ok: false,
      error: 'Respuesta inválida del server',
    }
  }

  // 2. Reemplazar cache local en una transacción.
  // Si algo falla en medio, todo se rollback automáticamente.
  try {
    await db.transaction('rw', [db.productos, db.clientes], async () => {
      // Replace all productos
      await db.productos.clear()
      if (data.productos.length > 0) {
        await db.productos.bulkPut(data.productos)
      }

      // Replace all clientes
      await db.clientes.clear()
      if (data.clientes.length > 0) {
        await db.clientes.bulkPut(data.clientes)
      }
    })

    // 3. Actualizar metadatos del último sync exitoso
    await setMeta(META_KEYS.LAST_CATALOG_SYNC_AT, data.synced_at)
    await setMeta(META_KEYS.LAST_CATALOG_SYNC_USER_ID, userId)

    return {
      ok: true,
      productosCount: data.productos.length,
      clientesCount: data.clientes.length,
      syncedAt: data.synced_at,
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Error escribiendo en IndexedDB',
    }
  }
}

/**
 * Verifica si hace falta sincronizar.
 * Política simple: si pasaron > 5 min desde el último sync exitoso, sí.
 * Si nunca se sincronizó, sí.
 */
export async function debeSincronizar(): Promise<boolean> {
  const FIVE_MINUTES = 5 * 60 * 1000

  const lastSync = await db.meta.get(META_KEYS.LAST_CATALOG_SYNC_AT)
  if (!lastSync || typeof lastSync.value !== 'number') {
    return true // nunca sincronizó
  }

  const elapsed = Date.now() - lastSync.value
  return elapsed > FIVE_MINUTES
}