// src/components/app/app-sidebar.tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  ShoppingCart,
  Package,
  Users,
  Receipt,
  BarChart3,
  Settings,
  Shield,
  ChevronsUpDown,
  LogOut,
  User as UserIcon,
  Inbox,
  UsersRound,
  Tags,
  History,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { SidebarPendientesBadge } from '@/components/app/sidebar-pendientes-badge'
import { limpiarDBLocal } from '@/lib/offline/db'
import type { CurrentUser } from '@/lib/auth/get-current-user'
import { cn } from '@/lib/utils'

type NavItem = {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

function getMenuItems(
  rol: CurrentUser['rol'],
  pedidosPendientes: number
): {
  principal: NavItem[]
  gestion?: NavItem[]
  superadmin?: NavItem[]
} {
  if (rol === 'vendedor') {
    return {
      principal: [{ title: 'Caja', url: '/caja', icon: ShoppingCart }],
      gestion: [
        {
          title: 'Pedidos',
          url: '/admin/pedidos',
          icon: Inbox,
        },
        { title: 'Productos', url: '/admin/productos', icon: Package },
      ],
    }
  }

  const base: {
    principal: NavItem[]
    gestion: NavItem[]
    superadmin?: NavItem[]
  } = {
    principal: [
      { title: 'Panel', url: '/admin', icon: Home },
      { title: 'Caja', url: '/caja', icon: ShoppingCart },
    ],
    gestion: [
      {
        title: 'Pedidos',
        url: '/admin/pedidos',
        icon: Inbox,
        badge: pedidosPendientes > 0 ? pedidosPendientes : undefined,
      },
      { title: 'Productos', url: '/admin/productos', icon: Package },
      { title: 'Clientes', url: '/admin/clientes', icon: Users },
      { title: 'Ventas', url: '/admin/ventas', icon: Receipt },
      { title: 'Turnos', url: '/admin/turnos', icon: History },
      { title: 'Reportes', url: '/admin/reportes', icon: BarChart3 },
      { title: 'Usuarios', url: '/admin/usuarios', icon: UsersRound },
      { title: 'Catálogos', url: '/admin/catalogos', icon: Tags },
      { title: 'Configuración', url: '/admin/configuracion', icon: Settings },
    ],
  }

  if (rol === 'superadmin') {
    base.superadmin = [
      { title: 'Auditoría', url: '/admin/auditoria', icon: Shield },
    ]
  }

  return base
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function roleLabel(rol: CurrentUser['rol']): string {
  switch (rol) {
    case 'superadmin':
      return 'Super Admin'
    case 'admin':
      return 'Administrador'
    case 'vendedor':
      return 'Vendedor'
    default:
      return rol
  }
}

/**
 * Versión más robusta: enviar POST y dejar que el server haga el redirect.
 */
function postSignout() {
  // Crear un form invisible y submitearlo
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/auth/signout'
  document.body.appendChild(form)
  form.submit()
}

export function AppSidebar({
  user,
  pedidosPendientes = 0,
  empresaNombre = null,
}: {
  user: CurrentUser
  pedidosPendientes?: number
  empresaNombre?: string | null
}) {
  const pathname = usePathname()
  const { isMobile } = useSidebar()

  const menu = getMenuItems(user.rol, pedidosPendientes)
  const initials = getInitials(user.nombre_completo)

  const isActive = (url: string) => {
    if (url === '/admin') return pathname === '/admin'
    if (url === '/caja')
      return pathname === '/caja' || pathname.startsWith('/caja/')
    return pathname.startsWith(url)
  }

  const renderMenuItems = (items: NavItem[]) => (
    <SidebarMenu>
      {items.map((item) => {
        const active = isActive(item.url)
        return (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton
              asChild
              tooltip={item.title}
              isActive={active}
              className={cn(
                'group/menu relative transition-all duration-200',
                'before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-0 before:w-[3px] before:rounded-r-full before:bg-primary before:transition-all before:duration-200',
                active && 'before:h-5',
                'hover:bg-sidebar-accent/60',
                active &&
                  'bg-sidebar-accent text-foreground font-medium hover:bg-sidebar-accent'
              )}
            >
              <Link href={item.url} prefetch>
                <item.icon
                  className={cn(
                    'size-4 transition-colors duration-200',
                    active
                      ? 'text-primary'
                      : 'text-muted-foreground group-hover/menu:text-foreground'
                  )}
                />
                <span
                  className={cn(
                    'transition-colors duration-200',
                    active ? 'text-foreground' : 'text-foreground/80'
                  )}
                >
                  {item.title}
                </span>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold font-numeric tabular-nums',
                      'bg-primary text-primary-foreground',
                      'shadow-sm ring-1 ring-primary/20',
                      'animate-in fade-in zoom-in-50 duration-300'
                    )}
                    aria-label={`${item.badge} pendientes`}
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="group/brand data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-sidebar-accent/60 transition-colors duration-200"
            >
              <Link
                href={user.rol === 'vendedor' ? '/caja' : '/admin'}
                prefetch
              >
                <div
                  className={cn(
                    'flex aspect-square size-8 items-center justify-center rounded-md',
                    'bg-primary text-primary-foreground',
                    'surface-1 ring-1 ring-primary/20',
                    'transition-transform duration-200 group-hover/brand:scale-105'
                  )}
                >
                  <span className="text-sm font-bold tracking-tight">L</span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold tracking-tight">
                    Lemma
                  </span>
                  {empresaNombre && (
                    <span className="truncate text-xs text-muted-foreground">
                      {empresaNombre}
                    </span>
                  )}
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-2 pt-2">
        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarPendientesBadge />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/70">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderMenuItems(menu.principal)}
          </SidebarGroupContent>
        </SidebarGroup>

        {menu.gestion && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/70">
              Gestión
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {renderMenuItems(menu.gestion)}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {menu.superadmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/70">
              Sistema
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {renderMenuItems(menu.superadmin)}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className={cn(
                    'group/user transition-colors duration-200',
                    'hover:bg-sidebar-accent/60',
                    'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                  )}
                >
                  <Avatar
                    className={cn(
                      'size-8 rounded-md',
                      'ring-1 ring-foreground/10 surface-1'
                    )}
                  >
                    <AvatarFallback className="rounded-md bg-muted text-foreground text-xs font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {user.nombre_completo}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {roleLabel(user.rol)}
                    </span>
                  </div>
                  <ChevronsUpDown
                    className={cn(
                      'ml-auto size-4 text-muted-foreground transition-transform duration-200',
                      'group-data-[state=open]/user:rotate-180'
                    )}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-2 py-2 text-left text-sm">
                    <Avatar className="size-8 rounded-md ring-1 ring-foreground/10 surface-1">
                      <AvatarFallback className="rounded-md bg-muted text-foreground text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {user.nombre_completo}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <UserIcon className="mr-2 size-4" />
                  Mi perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    // Limpiar IndexedDB ANTES del logout para que datos
                    // sensibles no queden accesibles sin sesión activa.
                    try {
                      await limpiarDBLocal()
                    } catch (err) {
                      console.warn(
                        '[logout] No se pudo limpiar IndexedDB:',
                        err
                      )
                    }
                    // Submitear form POST a /api/auth/signout (el endpoint
                    // hace el cleanup + redirect a /login).
                    postSignout()
                  }}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}