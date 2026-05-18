// src/lib/offline/db.ts
//
// Base de datos local (IndexedDB) de Lemma para soporte offline.

import Dexie, { type Table } from 'dexie'
import type { ProductoCaja } from '@/lib/queries/productos-caja'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'

export type MetaEntry = {
  key: string
  value: string | number | null
  updated_at: number
}

/**
 * Pedido en cola esperando sincronizar al volver internet.
 */
export type PedidoEnCola = {
  /** UUID local generado en el cliente. Se mantiene como referencia incluso
   *  después de sincronizar con el server (para tracking). */
  localId: string
  /** Estado de sincronización del pedido offline. */
  estado: 'pendiente' | 'sincronizando' | 'sincronizado' | 'error'
  /** Mensaje de error si la sincronización falló. */
  errorMensaje?: string
  /** Cuándo se creó el pedido en la tablet. */
  created_at: number
  /** Cuándo se sincronizó (si lo está). */
  synced_at?: number
  /** Número de pedido asignado por el server después del sync. */
  numeroServer?: number
  /** Datos del pedido (mismo shape que ya envía guardarPedido al server). */
  payload: {
    cliente_id: string | null
    /** Nombre alternativo del cliente. Persiste en ventas.nombre_cliente_custom. */
    nombre_cliente_custom: string | null
    nota_para_admin: string | null
    items: Array<{
      variante_id: string
      cantidad: number
      precio_unitario_neto: number
    }>
    usuario_id: string
  }
}

class LemmaDB extends Dexie {
  productos!: Table<ProductoCaja, string>
  clientes!: Table<ClienteCaja, string>
  meta!: Table<MetaEntry, string>
  colaPedidos!: Table<PedidoEnCola, string>

  constructor() {
    super('lemma-offline')

    // Versión 1: schema base.
    // Versión 2: agregar `nombre_cliente_custom` al payload de colaPedidos.
    //   No requiere upgrade explícito porque el campo es nullable y los
    //   pedidos viejos que no lo tengan van a quedar con `undefined` que
    //   se trata como `null` al sincronizar.
    this.version(1).stores({
      productos: 'id, sku_base, nombre, categoria',
      clientes: 'id, cuit, razon_social',
      meta: 'key',
      colaPedidos: 'localId, estado, created_at',
    })
  }
}

export const db = new LemmaDB()

export const META_KEYS = {
  LAST_CATALOG_SYNC_AT: 'last_catalog_sync_at',
  LAST_CATALOG_SYNC_USER_ID: 'last_catalog_sync_user_id',
} as const

export async function getMeta(key: string): Promise<MetaEntry | null> {
  try {
    const entry = await db.meta.get(key)
    return entry ?? null
  } catch (err) {
    console.error('[offline-db] Error leyendo meta', key, err)
    return null
  }
}

export async function setMeta(
  key: string,
  value: string | number | null
): Promise<void> {
  try {
    await db.meta.put({
      key,
      value,
      updated_at: Date.now(),
    })
  } catch (err) {
    console.error('[offline-db] Error escribiendo meta', key, err)
  }
}

export async function limpiarDBLocal(): Promise<void> {
  try {
    await db.transaction(
      'rw',
      [db.productos, db.clientes, db.meta, db.colaPedidos],
      async () => {
        await db.productos.clear()
        await db.clientes.clear()
        await db.meta.clear()
        await db.colaPedidos.clear()
      }
    )
  } catch (err) {
    console.error('[offline-db] Error limpiando DB local', err)
  }
}