// src/app/(app)/caja/_hooks/use-catalog-data.ts
//
// Hook que abstrae la fuente del catálogo (productos + clientes) para la caja.
//
// Estrategia (stale-while-revalidate):
// 1. AL MONTAR: leer IndexedDB sincrónicamente. Si hay datos, mostrarlos
//    INSTANTÁNEAMENTE (status: 'ready', source: 'local').
// 2. EN PARALELO: fetch al server en background. Si responde OK, actualizar
//    el estado con datos frescos (status: 'ready', source: 'server') y
//    escribir a IndexedDB.
// 3. Si IndexedDB está vacío Y no hay internet → 'empty'.
// 4. Si IndexedDB está vacío PERO hay internet → 'loading' breve hasta que
//    fetch responda.
//
// El estado `serverFetchSettled` indica si el fetch al server ya terminó
// (sea con éxito o falló por red). Esto permite distinguir entre:
//   - "estoy mostrando cache pero el server fetch sigue en background" → no avisar offline
//   - "el server fetch falló, realmente estoy offline" → mostrar banner
//
// Resultado: primera vez de la sesión + ya hay cache → INSTANT. No hay loader.
// Solo se ve loader en la primerísima entrada después de login (cache vacío).

'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/offline/db'
import type { ProductoCaja } from '@/lib/queries/productos-caja'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'

type CatalogData = {
  productos: ProductoCaja[]
  clientes: ClienteCaja[]
}

export type CatalogState =
  | { status: 'loading' }
  | {
      status: 'ready'
      data: CatalogData
      source: 'server' | 'local'
      /**
       * Si el server fetch ya terminó (sea con éxito o falló).
       * Sirve para no mostrar el banner "offline" durante el período breve
       * en que mostramos cache local mientras esperamos al server.
       */
      serverFetchSettled: boolean
    }
  | { status: 'empty'; reason: 'offline-no-cache' | 'error'; message: string }

export function useCatalogData(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    // ---------- FASE 1: Hidratar desde IndexedDB inmediatamente ----------
    async function hydrateFromCache(): Promise<boolean> {
      try {
        const [productos, clientes] = await Promise.all([
          db.productos.toArray(),
          db.clientes.toArray(),
        ])

        if (cancelled) return false

        if (productos.length === 0 && clientes.length === 0) {
          return false // no había cache
        }

        productos.sort((a, b) => a.nombre.localeCompare(b.nombre))
        clientes.sort((a, b) => a.razon_social.localeCompare(b.razon_social))

        setState({
          status: 'ready',
          data: { productos, clientes },
          source: 'local',
          serverFetchSettled: false, // aún no terminó el fetch al server
        })
        return true
      } catch (err) {
        console.warn('[catalog-data] Error leyendo IndexedDB:', err)
        return false
      }
    }

    // ---------- FASE 2: Refrescar desde server en background ----------
    async function refreshFromServer(hadCache: boolean) {
      try {
        const response = await fetch('/api/sync/catalog', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        })

        if (!response.ok) {
          if (cancelled) return
          // Server respondió mal. Si ya teníamos cache, marcamos serverFetchSettled
          // y mantenemos el cache visible (con banner offline).
          // Si no teníamos cache, mostramos empty.
          if (!hadCache) {
            setState({
              status: 'empty',
              reason: 'error',
              message: `El servidor respondió con error (${response.status}). Intentá recargar la página.`,
            })
          } else {
            // Marcar el fetch como settled (falló) → ahí sí avisar offline
            setState((prev) => {
              if (prev.status !== 'ready') return prev
              return { ...prev, serverFetchSettled: true }
            })
          }
          return
        }

        const data = (await response.json()) as CatalogData & {
          synced_at: number
        }

        if (cancelled) return

        // Actualizar UI con datos frescos del server
        setState({
          status: 'ready',
          data: { productos: data.productos, clientes: data.clientes },
          source: 'server',
          serverFetchSettled: true,
        })

        // Escribir a IndexedDB para próximas sesiones offline (no bloqueante)
        db.transaction('rw', [db.productos, db.clientes], async () => {
          await db.productos.clear()
          if (data.productos.length > 0) {
            await db.productos.bulkPut(data.productos)
          }
          await db.clientes.clear()
          if (data.clientes.length > 0) {
            await db.clientes.bulkPut(data.clientes)
          }
        }).catch((err) => {
          console.warn('[catalog-data] No se pudo escribir IndexedDB:', err)
        })
      } catch (_err) {
        // Error de red: estamos offline.
        if (cancelled) return
        if (!hadCache) {
          setState({
            status: 'empty',
            reason: 'offline-no-cache',
            message:
              'No hay catálogo cacheado y no se puede contactar al servidor. Conectate a internet al menos una vez para cargar el catálogo.',
          })
        } else {
          // Había cache. Marcar fetch como settled (falló) → mostrar banner offline.
          setState((prev) => {
            if (prev.status !== 'ready') return prev
            return { ...prev, serverFetchSettled: true }
          })
        }
      }
    }

    async function load() {
      const hadCache = await hydrateFromCache()
      // Refresh en background. Si había cache, no bloquea ni muestra loader.
      // Si no había cache, sigue en 'loading' hasta que el fetch responda.
      void refreshFromServer(hadCache)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}