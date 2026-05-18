// src/components/app/sidebar-pendientes-badge.tsx
//
// Badge que muestra el contador de pedidos pendientes de sincronizar.
// Se actualiza en TIEMPO REAL gracias a useLiveQuery de dexie-react-hooks:
// cuando se encola un pedido nuevo o cuando uno se sincroniza, el badge
// se redibuja automáticamente sin polling.
//
// Visible para: vendedores y admins (cualquiera que pueda generar pedidos).
// Si count = 0, no se renderiza nada (no quema espacio en el sidebar).
//
// Click en el item → abre /caja con foco en la sección de pendientes.
// (Próximamente: pantalla dedicada /caja/pendientes en Fase 4.2)

'use client'

import Link from 'next/link'
import { CloudOff } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/offline/db'
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * Hook reactivo: cuenta pedidos en estado 'pendiente' o 'error'.
 * Errores también se cuentan porque también son "pedidos sin enviar al server"
 * y la vendedora necesita saber que están en cola (aunque hayan fallado el último intento).
 */
function useCountPendientes(): number {
  const count = useLiveQuery(async () => {
    try {
      // Contamos 'pendiente' + 'error' como "pendientes de sincronizar"
      const pendientes = await db.colaPedidos
        .where('estado')
        .equals('pendiente')
        .count()
      const errores = await db.colaPedidos
        .where('estado')
        .equals('error')
        .count()
      return pendientes + errores
    } catch {
      return 0
    }
  }, [])

  return count ?? 0
}

export function SidebarPendientesBadge() {
  const count = useCountPendientes()

  // Si no hay pendientes, no renderizar nada
  if (count === 0) return null

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={`${count} ${count === 1 ? 'pedido pendiente' : 'pedidos pendientes'} de sincronizar`}
        className={cn(
          'group/menu relative transition-all duration-200',
          'hover:bg-warning/10',
          'border-l-[3px] border-l-warning/70'
        )}
      >
        <Link href="/caja">
          <CloudOff className="size-4 text-warning shrink-0" />
          <span className="text-foreground/90 text-sm">
            Pendientes de sync
          </span>
          <span
            className={cn(
              'ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full',
              'text-[10px] font-semibold font-numeric tabular-nums',
              'bg-warning text-warning-foreground',
              'shadow-sm ring-1 ring-warning/30',
              'animate-in fade-in zoom-in-50 duration-300'
            )}
            aria-label={`${count} pendientes`}
          >
            {count > 99 ? '99+' : count}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}