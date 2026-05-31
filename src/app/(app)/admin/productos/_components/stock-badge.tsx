import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

export type NivelStock = 'sin' | 'bajo' | 'normal' | 'sin-track'

/**
 * Clasifica el stock en niveles. Fuente única de verdad reusada por el
 * StockBadge y la banda de color de la fila/card (no duplicar el umbral).
 *  - 0       → 'sin'
 *  - 1-4     → 'bajo'
 *  - 5+      → 'normal'
 *  - !track  → 'sin-track'
 */
export function nivelStock(stock: number, trackStock = true): NivelStock {
  if (!trackStock) return 'sin-track'
  if (stock === 0) return 'sin'
  if (stock < 5) return 'bajo'
  return 'normal'
}

/**
 * Clase de color para la banda vertical de stock al borde de la fila/card.
 * null = sin banda (stock normal o sin track).
 */
export function bandaStockClase(
  stock: number,
  trackStock = true
): string | null {
  const nivel = nivelStock(stock, trackStock)
  if (nivel === 'sin') return 'bg-destructive'
  if (nivel === 'bajo') return 'bg-warning'
  return null
}

/**
 * Badge de stock con color de estado para escaneo rápido del listado.
 *
 * Usa los tokens semánticos del theme (destructive/warning/success) — los
 * mismos que ya usa el badge "Activo" y el color de stock de la tabla. La
 * paleta achromatic del proyecto es para el branding; el color de ESTADO
 * (stock, activo) es una excepción ya establecida en el design system.
 *
 *  - 0       → destructive (rojo)  "Sin stock"
 *  - 1-4     → warning (ámbar)     "Stock bajo: n"
 *  - 5+      → success (verde)     "n unidades"
 *  - sin track → neutro            "Sin control"
 */
export function StockBadge({
  stock,
  trackStock = true,
  className,
}: {
  stock: number
  trackStock?: boolean
  className?: string
}) {
  const nivel = nivelStock(stock, trackStock)

  if (nivel === 'sin-track') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        Sin control
      </Badge>
    )
  }

  if (nivel === 'sin') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'border-destructive/40 bg-destructive/10 text-destructive',
          className
        )}
      >
        Sin stock
      </Badge>
    )
  }

  if (nivel === 'bajo') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'border-warning/40 bg-warning/10 text-warning',
          className
        )}
      >
        Stock bajo: {formatNumber(stock)}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className={cn('border-success/40 bg-success/10 text-success', className)}
    >
      {formatNumber(stock)} unidades
    </Badge>
  )
}
