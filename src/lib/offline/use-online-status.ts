// src/lib/offline/use-online-status.ts
//
// Hook React que detecta si la app tiene conectividad real al server.
//
// `navigator.onLine` no es confiable: devuelve true si hay Wi-Fi conectado
// aunque no haya internet detrás, o si el router está sin uplink. Para POS
// en Avellaneda con cortes de luz/internet, eso es un caso REAL.
//
// Estrategia event-driven (sin polling):
// 1. `navigator.onLine` como señal rápida e inicial (cambios instantáneos).
// 2. Un único ping a /api/ping al montar (solo si navigator.onLine es true)
//    para confirmar que detrás del Wi-Fi hay internet de verdad.
// 3. Un ping puntual cada vez que el browser dispara el evento `online`
//    (confirma conectividad real al recuperar conexión).
// 4. En el evento `offline` marcamos isOnline=false directo, sin pingear
//    (no tiene sentido pingear si el SO ya nos dice que no hay red).
//
// La conectividad real solo cambia cuando el SO dispara online/offline, así
// que NO hay polling recurrente: pollear entre eventos era puro desperdicio
// de Edge Requests. Para reactividad inmediata en operaciones críticas como
// guardar pedido, los componentes detectan el error de red directamente
// (try/catch del fetch) y encolan offline (ver modal-guardar-pedido.tsx).

'use client'

import { useEffect, useState } from 'react'

const PING_TIMEOUT_MS = 5_000 // si tarda más de 5s, falló

type OnlineStatus = {
  isOnline: boolean
  lastSuccessfulPing: number | null
}

async function pingServer(): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)

  try {
    const response = await fetch('/api/ping', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    clearTimeout(timeoutId)
    return false
  }
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(() => ({
    isOnline:
      typeof window !== 'undefined' && 'onLine' in navigator
        ? navigator.onLine
        : true,
    lastSuccessfulPing: null,
  }))

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false

    async function confirmarConexion() {
      const ok = await pingServer()
      if (cancelled) return

      if (ok) {
        setStatus({
          isOnline: true,
          lastSuccessfulPing: Date.now(),
        })
      } else {
        setStatus((prev) => {
          if (!prev.isOnline) return prev
          return { ...prev, isOnline: false }
        })
      }
    }

    // Ping único al montar, solo si el SO dice que hay red.
    if (navigator.onLine) {
      void confirmarConexion()
    }

    const handleOnline = () => {
      void confirmarConexion()
    }
    const handleOffline = () => {
      setStatus((prev) => {
        if (!prev.isOnline) return prev
        return { ...prev, isOnline: false }
      })
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return status
}

/**
 * Hook adicional que provee una función imperativa para marcar como offline
 * cuando un componente detecta que un fetch falló por red.
 *
 * Esto NO existe (el hook actual solo lee estado). Si en el futuro queremos
 * que componentes le digan al hook "che, el server me dio timeout, marcá
 * offline", agregaríamos un context provider con una action setOffline.
 *
 * Por ahora, los componentes simplemente detectan el error en su try/catch
 * y deciden el flujo localmente (ver modal-guardar-pedido.tsx).
 */
