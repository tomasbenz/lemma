// src/components/app/realtime-refresher.tsx
'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox } from 'lucide-react'
import {
  useRealtimePedidos,
  type VentaRealtimePayload,
} from '@/lib/realtime/use-realtime-pedidos'
import type { CurrentUser } from '@/lib/auth/get-current-user'

type Props = {
  rol: CurrentUser['rol']
}

/**
 * Componente client invisible que vive en el layout y dispara router.refresh()
 * cuando hay cambios realtime en la tabla `ventas`.
 *
 * Esto causa que el server re-ejecute las queries del layout (incluyendo
 * `contarPedidosPendientes()`) y el sidebar se re-renderea con el badge
 * actualizado. También refresca cualquier server component que esté en pantalla
 * (dashboard, listado pedidos, listado ventas).
 *
 * Notificaciones toast solo para admin/superadmin: la vendedora no necesita
 * notificación porque ELLA es la que crea los pedidos.
 */
export function RealtimeRefresher({ rol }: Props) {
  const router = useRouter()
  const esAdmin = rol === 'admin' || rol === 'superadmin'

  const handleInsertGuardada = useCallback(
    (venta: VentaRealtimePayload) => {
      router.refresh()

      // Toast solo para admin: pedido nuevo entró
      if (esAdmin) {
        toast.success(`Pedido #${venta.numero} recibido`, {
          description: 'Un nuevo pedido necesita finalizarse',
          icon: <Inbox className="size-4" />,
          duration: 4000,
        })
      }
    },
    [router, esAdmin]
  )

  const handleUpdate = useCallback(
    (venta: VentaRealtimePayload, anterior: VentaRealtimePayload) => {
      // Solo refrescamos si cambió el estado (lo que afecta listados/badge)
      // No refrescamos por updates triviales como visto_at, monto_facturado, etc.
      if (venta.estado !== anterior.estado) {
        router.refresh()
      }
    },
    [router]
  )

  useRealtimePedidos({
    onInsertGuardada: handleInsertGuardada,
    onUpdate: handleUpdate,
  })

  return null
}