'use client'

import { Fragment, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Crumb = {
  label: string
  href: string | null
}

/**
 * Breadcrumbs que se autogeneran según la ruta actual.
 * Mapea segmentos de URL a labels humanos.
 */
export function Breadcrumbs() {
  const pathname = usePathname()

  const crumbs = useMemo(() => construirCrumbs(pathname), [pathname])

  // No mostrar breadcrumbs en home/caja (primer nivel)
  if (crumbs.length <= 1) return null

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex items-center gap-1 text-sm text-muted-foreground min-w-0"
    >
      {crumbs.map((crumb, i) => {
        const esUltimo = i === crumbs.length - 1
        return (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            {esUltimo || !crumb.href ? (
              <span
                className={cn(
                  'truncate',
                  esUltimo && 'text-foreground font-medium'
                )}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

/**
 * Labels legibles para cada segmento conocido.
 */
const LABELS: Record<string, string> = {
  admin: 'Admin',
  productos: 'Productos',
  ventas: 'Ventas',
  clientes: 'Clientes',
  reportes: 'Reportes',
  configuracion: 'Configuración',
  auditoria: 'Auditoría',
  caja: 'Caja',
  nuevo: 'Nuevo',
  editar: 'Editar',
}

/**
 * Segmentos que son rutas navegables (clickeables en breadcrumb).
 * Los que NO están acá se muestran pero no son links.
 */
const NAVEGABLES = new Set([
  'admin',
  'caja',
  'admin/productos',
  'admin/ventas',
  'admin/clientes',
  'admin/reportes',
  'admin/configuracion',
  'admin/auditoria',
])

function construirCrumbs(pathname: string): Crumb[] {
  if (pathname === '/' || pathname === '/caja') {
    return [{ label: 'Caja', href: null }]
  }

  const segmentos = pathname.split('/').filter(Boolean)
  if (segmentos.length === 0) return []

  const crumbs: Crumb[] = []
  let acumulado = ''

  for (let i = 0; i < segmentos.length; i++) {
    const seg = segmentos[i]
    acumulado += `/${seg}`
    const sinSlash = acumulado.slice(1)

    const label = traducirSegmento(seg, segmentos, i)
    const navegable = NAVEGABLES.has(sinSlash)

    crumbs.push({
      label,
      href: navegable ? acumulado : null,
    })
  }

  return crumbs
}

function traducirSegmento(
  seg: string,
  todos: string[],
  index: number
): string {
  // Si es un label conocido, usarlo
  if (LABELS[seg]) return LABELS[seg]

  // Si es un UUID (detalle de entidad), mostrar "#<algo>"
  // Buscamos padre para decidir el prefijo
  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    seg
  )
  if (esUuid) {
    const padre = todos[index - 1]
    switch (padre) {
      case 'ventas':
        return 'Detalle de venta'
      case 'productos':
        return 'Detalle de producto'
      case 'clientes':
        return 'Detalle de cliente'
      default:
        return 'Detalle'
    }
  }

  // Si es numérico, "#123"
  if (/^\d+$/.test(seg)) {
    return `#${seg}`
  }

  // Default: capitalizar
  return seg.charAt(0).toUpperCase() + seg.slice(1)
}