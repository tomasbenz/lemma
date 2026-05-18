'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { CurrentUser } from '@/lib/auth/get-current-user'

type Props = {
  rol: CurrentUser['rol']
}

/**
 * Registra shortcuts globales de navegación estilo Vim/Linear:
 * - G luego C → ir a Caja
 * - G luego P → ir a Productos (admin/superadmin)
 * - G luego V → ir a Ventas (admin/superadmin)
 * - G luego H → ir al Panel / inicio (admin/superadmin)
 *
 * Funciona: el usuario presiona G, tiene 1.2s para presionar la segunda tecla.
 * No se activa si el foco está en un input/textarea/contenteditable.
 */
export function GlobalShortcuts({ rol }: Props) {
  const router = useRouter()
  // Guardamos si estamos "esperando la segunda tecla" después de G
  const waitingForSecondKey = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function esElementoEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (target.isContentEditable) return true
      return false
    }

    function cancelarEspera() {
      waitingForSecondKey.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    function navegar(ruta: string, label: string) {
      router.push(ruta)
      toast.success(`→ ${label}`, { duration: 800 })
    }

    function onKey(e: KeyboardEvent) {
      // Ignorar si hay modificadores (salvo Shift para la tecla en mayúscula)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Ignorar si el usuario está escribiendo
      if (esElementoEditable(e.target)) {
        cancelarEspera()
        return
      }

      const key = e.key.toLowerCase()

      // Si estamos esperando la segunda tecla después de G
      if (waitingForSecondKey.current) {
        cancelarEspera()

        switch (key) {
          case 'c':
            e.preventDefault()
            navegar('/caja', 'Caja')
            return
          case 'p':
            // Vendedora ahora tiene acceso al catalogo (solo lectura +
            // ajustar stock), asi que G P le sirve.
            e.preventDefault()
            navegar('/admin/productos', 'Productos')
            return
          case 'v':
            if (rol === 'vendedor') return
            e.preventDefault()
            navegar('/admin/ventas', 'Ventas')
            return
          case 'h':
            if (rol === 'vendedor') return
            e.preventDefault()
            navegar('/admin', 'Panel')
            return
          default:
            // Tecla no reconocida después de G, cancelamos y seguimos normal
            return
        }
      }

      // Arrancar secuencia con G
      if (key === 'g') {
        waitingForSecondKey.current = true
        timeoutRef.current = setTimeout(cancelarEspera, 1200)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      cancelarEspera()
    }
  }, [router, rol])

  return null
}