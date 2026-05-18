// src/app/(app)/admin/pedidos/[id]/_components/marcar-visto-effect.tsx
'use client'

import { useEffect } from 'react'
import { marcarPedidoVisto } from '../../_actions/marcar-pedido-visto'

/**
 * Componente client-only que marca un pedido como "visto" al montarse.
 * 
 * Vive como hijo del page (server component) y dispara la action via useEffect
 * para evitar el error "revalidatePath during render" de Next.js 16.
 * 
 * Es idempotente: si el pedido ya estaba visto, la action no hace nada.
 * No bloquea ni muestra errores al usuario - es un efecto secundario silencioso.
 */
export function MarcarVistoEffect({ pedidoId }: { pedidoId: string }) {
  useEffect(() => {
    // Fire and forget. Si falla, lo loggeamos pero no molestamos al user.
    marcarPedidoVisto(pedidoId).catch((err) => {
      console.error('[MarcarVistoEffect]', err)
    })
  }, [pedidoId])

  return null
}