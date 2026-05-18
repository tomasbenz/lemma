// src/app/(app)/layout.tsx
//
// IMPORTANTE: force-dynamic + revalidate 0
// Esto desactiva el cache server-side de Next.js para todas las pages
// hijas de (app). Es CRÍTICO para multitenant: cuando un superadmin
// cambia de empresa via impersonación, el cache de Next.js (basado en
// user_id) podría servir HTML viejo de la empresa anterior porque el
// user_id no cambia. Con force-dynamic, cada request va al server fresh.

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { contarPedidosPendientes } from '@/lib/queries/pedidos'
import { createClient } from '@/lib/supabase/server'
import { AppSidebar } from '@/components/app/app-sidebar'
import { GlobalShortcuts } from '@/components/app/global-shortcuts'
import { ShortcutsCheatsheet } from '@/components/app/shortcuts-cheatsheet'
import { Breadcrumbs } from '@/components/app/breadcrumbs'
import { TopbarHelpButton } from '@/components/app/topbar-help-button'
import { CommandPalette } from '@/components/app/command-palette'
import { RealtimeRefresher } from '@/components/app/realtime-refresher'
import { SidebarProviderResponsive } from '@/components/app/sidebar-provider-responsive'
import { OfflineSyncTrigger } from '@/components/app/offline-sync-trigger'
import { SuperadminBanner } from '@/components/app/superadmin-banner'
import { salirDeEmpresa } from '@/app/superadmin/_actions/empresa-impersonacion'
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'

// Forzar render dinámico en TODAS las pages hijas
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  // Superadmin sin empresa activa → al panel /superadmin
  if (user.rol === 'superadmin' && !user.empresa_id) {
    redirect('/superadmin')
  }

  // Solo admin/superadmin ven el badge de pedidos pendientes
  const pedidosPendientes =
    user.rol === 'vendedor' ? 0 : await contarPedidosPendientes()

  // Cargar nombre de empresa para sidebar y banner.
  // Cliente normal con RLS: la policy empresas_select permite al user
  // leer su propia empresa (id = get_empresa_id()).
  // También chequeamos `activo`: si la empresa quedó desactivada mid-sesión,
  // bloqueamos el acceso (superadmin → vuelve al panel limpiando impersonación;
  // resto → logout).
  let empresaNombre: string | null = null
  if (user.empresa_id) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('empresas')
      .select('nombre, activo')
      .eq('id', user.empresa_id)
      .single()

    if (data && !data.activo) {
      if (user.rol === 'superadmin') {
        // Limpia la impersonación y redirige al panel (salirDeEmpresa
        // hace el redirect internamente con next/navigation).
        await salirDeEmpresa()
      } else {
        await supabase.auth.signOut()
        redirect('/login?error=empresa_desactivada')
      }
    }

    empresaNombre = data?.nombre ?? null
  }

  return (
    <TooltipProvider delayDuration={100}>
      <SidebarProviderResponsive>
        <AppSidebar
          user={user}
          pedidosPendientes={pedidosPendientes}
          empresaNombre={empresaNombre}
        />
        <SidebarInset>
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {user.esta_impersonando && empresaNombre && (
              <SuperadminBanner empresaNombre={empresaNombre} />
            )}
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
              <Breadcrumbs />
              <div className="flex-1" />
              <TopbarHelpButton />
            </header>
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProviderResponsive>
      <GlobalShortcuts rol={user.rol} />
      <ShortcutsCheatsheet rol={user.rol} />
      <CommandPalette rol={user.rol} />

      <RealtimeRefresher rol={user.rol} />
      <OfflineSyncTrigger userId={user.id} />
    </TooltipProvider>
  )
}