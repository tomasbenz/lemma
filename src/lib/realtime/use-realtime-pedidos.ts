// src/lib/realtime/use-realtime-pedidos.ts
'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

/**
 * Tipo del payload que viene de Supabase Realtime para la tabla `ventas`.
 *
 * No tipamos esto contra `Database['public']['Tables']['ventas']['Row']`
 * porque Supabase devuelve `Record<string, any>` desde realtime. Lo tipamos
 * por separado con los campos que nos interesan.
 */
export type VentaRealtimePayload = {
  id: string
  numero: number
  estado: 'guardada' | 'cerrada' | 'anulada'
  usuario_id: string
  cliente_id: string | null
  total: number | null
  created_at: string
  visto_at?: string | null
  [key: string]: unknown
}

type Handlers = {
  /** Llamado cuando se inserta un pedido nuevo (estado='guardada') */
  onInsertGuardada?: (venta: VentaRealtimePayload) => void
  /** Llamado cuando un pedido cambia de estado (cerrada/anulada) */
  onUpdate?: (venta: VentaRealtimePayload, anterior: VentaRealtimePayload) => void
}

/**
 * Suscribirse a cambios realtime en la tabla `ventas`.
 *
 * Filtra por `estado=eq.guardada` en INSERT (solo pedidos pendientes).
 * Para UPDATE escucha todos los cambios y deja que el caller filtre.
 *
 * RLS aplica: vendedora solo recibe eventos de sus propias ventas,
 * admin/superadmin reciben todo.
 *
 * IMPORTANTE: pasar handlers estables (envueltos en useCallback en el caller)
 * para evitar re-suscripciones en cada render.
 */
export function useRealtimePedidos(handlers: Handlers) {
  // Guardamos los handlers en un ref para que el effect no dependa de ellos
  // y no se re-suscriba cuando cambian (suelen ser closures inline).
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('realtime:ventas')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ventas',
          filter: 'estado=eq.guardada',
        },
        (payload: RealtimePostgresChangesPayload<VentaRealtimePayload>) => {
          if (payload.new && 'id' in payload.new) {
            handlersRef.current.onInsertGuardada?.(
              payload.new as VentaRealtimePayload
            )
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ventas',
        },
        (payload: RealtimePostgresChangesPayload<VentaRealtimePayload>) => {
          if (
            payload.new &&
            'id' in payload.new &&
            payload.old &&
            'id' in payload.old
          ) {
            handlersRef.current.onUpdate?.(
              payload.new as VentaRealtimePayload,
              payload.old as VentaRealtimePayload
            )
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[realtime:ventas]', status)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
}