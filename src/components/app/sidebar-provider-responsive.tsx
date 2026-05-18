// src/components/app/sidebar-provider-responsive.tsx
'use client'

import { useEffect, useState } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'

/**
 * Wrapper client de SidebarProvider que colapsa el sidebar por default
 * en pantallas chicas (< lg = 1024px).
 *
 * En desktop el sidebar arranca abierto (comportamiento de siempre).
 * En tablet/mobile arranca colapsado a icon-only para liberar espacio
 * horizontal — crítico para la grilla de productos en caja.
 *
 * El usuario siempre puede expandirlo/colapsarlo manualmente con el
 * SidebarTrigger del header. La preferencia luego persiste en cookie
 * por el comportamiento default de shadcn-ui.
 *
 * Nota sobre SSR: arrancamos con `open=true` en el server (asumimos desktop)
 * y ajustamos en cliente al montar. En tablet hay un flash imperceptible
 * (~50ms) con sidebar abierto antes de colapsar. Aceptable.
 */
export function SidebarProviderResponsive({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    // En cliente, decidir según ancho real de la pantalla.
    // lg breakpoint de Tailwind = 1024px
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    setOpen(isDesktop)
  }, [])

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      {children}
    </SidebarProvider>
  )
}