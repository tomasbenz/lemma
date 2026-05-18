// src/lib/offline/use-online-status.ts
//
// Hook React que detecta si la app tiene conectividad real al server.
//
// `navigator.onLine` no es confiable: devuelve true si hay Wi-Fi conectado
// aunque no haya internet detrás, o si el router está sin uplink. Para POS
// en Avellaneda con cortes de luz/internet, eso es un caso REAL.
//
// Estrategia híbrida:
// 1. `navigator.onLine` como señal rápida (cambios instantáneos)
// 2. Ping a /api/ping cada 30s para confirmar (cambios más lentos pero reales)
// 3. Si dos pings seguidos fallan → consideramos offline
// 4. Cuando vuelve a responder → online inmediato
//
// Nota: el hook tarda hasta 60s en detectar que está offline (2 pings fallidos
// consecutivos a 30s cada uno). Para reactividad inmediata en operaciones
// críticas como guardar pedido, los componentes detectan el error de red
// directamente (try/catch del fetch) y encolan offline.

'use client'

import { useEffect, useRef, useState } from 'react'

const PING_INTERVAL_MS = 30_000 // 30 segundos
const PING_TIMEOUT_MS = 5_000 // si tarda más de 5s, falló
const PING_FAILS_BEFORE_OFFLINE = 2 // 2 fallos seguidos = offline

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

  const failsRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false

    async function checkConnection() {
      const ok = await pingServer()
      if (cancelled) return

      if (ok) {
        failsRef.current = 0
        setStatus((prev) => {
          if (prev.isOnline) {
            return { ...prev, lastSuccessfulPing: Date.now() }
          }
          return { isOnline: true, lastSuccessfulPing: Date.now() }
        })
      } else {
        failsRef.current += 1
        if (failsRef.current >= PING_FAILS_BEFORE_OFFLINE) {
          setStatus((prev) => {
            if (!prev.isOnline) return prev
            return { ...prev, isOnline: false }
          })
        }
      }
    }

    checkConnection()

    const intervalId = setInterval(checkConnection, PING_INTERVAL_MS)

    const handleOnline = () => {
      void checkConnection()
    }
    const handleOffline = () => {
      failsRef.current = PING_FAILS_BEFORE_OFFLINE
      setStatus((prev) => {
        if (!prev.isOnline) return prev
        return { ...prev, isOnline: false }
      })
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      cancelled = true
      clearInterval(intervalId)
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