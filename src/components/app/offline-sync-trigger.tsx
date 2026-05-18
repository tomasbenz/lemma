// src/components/app/offline-sync-trigger.tsx
//
// Componente cliente invisible que se monta una vez en el layout (app)
// y dispara la sincronización del catálogo Y de la cola de pedidos cuando
// corresponde.
//
// Cuándo sincroniza:
// 1. Al montar (login / primera carga) si no hay sync reciente
// 2. Cuando recupera conexión después de estar offline
// 3. Cada 5 minutos mientras la app está abierta y hay internet
//
// Sync de catálogo: trae productos+clientes del server al IndexedDB.
// Sync de pedidos: envía pedidos en cola al server.
//
// Ambos syncs son independientes y se ejecutan en paralelo.
//
// No renderiza nada visible. Solo efectos.

'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useOnlineStatus } from '@/lib/offline/use-online-status'
import {
  syncCatalogFromServer,
  debeSincronizar,
} from '@/lib/offline/sync-catalog'
import { syncOrdersFromQueue } from '@/lib/offline/sync-orders'
import { resetSincronizando } from '@/lib/offline/order-queue'

const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 min

type OfflineSyncTriggerProps = {
  userId: string
}

export function OfflineSyncTrigger({ userId }: OfflineSyncTriggerProps) {
  const { isOnline } = useOnlineStatus()
  const syncing = useRef(false)
  const wasOnline = useRef(isOnline)

  async function attemptSync(reason: string) {
    if (syncing.current) return
    if (!isOnline) return

    syncing.current = true
    try {
      // Catálogo y pedidos en paralelo. Son independientes:
      // catálogo lee del server hacia IndexedDB.
      // pedidos lee de IndexedDB hacia el server.
      const [catalogResult, ordersResult] = await Promise.all([
        syncCatalogFromServer(userId),
        syncOrdersFromQueue(),
      ])

      if (!catalogResult.ok) {
        console.warn(
          '[sync-trigger]',
          reason,
          '→ catálogo falló:',
          catalogResult.error
        )
      } else {
        console.info(
          '[sync-trigger]',
          reason,
          `→ catálogo OK (${catalogResult.productosCount} productos, ${catalogResult.clientesCount} clientes)`
        )
      }

      // Si sincronizamos pedidos, mostrar toast a la vendedora
      if (ordersResult.synced > 0) {
        toast.success(
          `${ordersResult.synced} ${ordersResult.synced === 1 ? 'pedido sincronizado' : 'pedidos sincronizados'}`,
          { duration: 3000 }
        )
      }
      if (ordersResult.errors > 0) {
        toast.error(
          `${ordersResult.errors} ${ordersResult.errors === 1 ? 'pedido falló al sincronizar' : 'pedidos fallaron al sincronizar'}`,
          {
            description:
              'Revisá la lista de pedidos pendientes para más detalle.',
            duration: 5000,
          }
        )
      }
      if (ordersResult.attempted > 0) {
        console.info(
          '[sync-trigger]',
          reason,
          `→ pedidos: ${ordersResult.synced}/${ordersResult.attempted} sincronizados, ${ordersResult.errors} errores`
        )
      }
    } finally {
      syncing.current = false
    }
  }

  // Efecto 1: sync al montar si corresponde.
  // También resetea pedidos en estado 'sincronizando' (por si la app se cerró
  // a mitad de un sync anterior, no quedan pedidos en limbo).
  useEffect(() => {
    void (async () => {
      // Reset preventivo de pedidos en limbo (por crash de app anterior)
      await resetSincronizando()

      if (!isOnline) return

      const debe = await debeSincronizar()
      if (debe) {
        void attemptSync('mount')
      } else {
        // Aunque no debamos sincronizar catálogo (es reciente), igual intentamos
        // sincronizar pedidos pendientes si hay alguno.
        void syncOrdersFromQueue().then((result) => {
          if (result.synced > 0) {
            toast.success(
              `${result.synced} ${result.synced === 1 ? 'pedido sincronizado' : 'pedidos sincronizados'}`,
              { duration: 3000 }
            )
          }
        })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Efecto 2: sync al recuperar conexión
  useEffect(() => {
    const wasOfflineBefore = !wasOnline.current
    wasOnline.current = isOnline

    if (isOnline && wasOfflineBefore) {
      void attemptSync('recovered-online')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  // Efecto 3: sync periódico cada 5 min
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!isOnline) return
      void attemptSync('periodic')
    }, PERIODIC_SYNC_INTERVAL_MS)

    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  return null
}