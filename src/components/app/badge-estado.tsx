// src/components/app/badge-estado.tsx
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type EstadoVenta = 'abierta' | 'guardada' | 'cerrada' | 'anulada'

type Props = {
  estado: EstadoVenta | string
  /** Variante del label: 'venta' (Cerrada) o 'pedido' (Pendiente para 'guardada') */
  contexto?: 'venta' | 'pedido'
  className?: string
}

const map: Record<
  EstadoVenta,
  { label: string; labelPedido: string; className: string; dot: string }
> = {
  guardada: {
    label: 'Guardada',
    labelPedido: 'Pendiente',
    className: 'text-info bg-info/10 border-info/40',
    dot: 'bg-info',
  },
  cerrada: {
    label: 'Cerrada',
    labelPedido: 'Cerrada',
    className: 'text-success bg-success/10 border-success/40',
    dot: 'bg-success',
  },
  anulada: {
    label: 'Anulada',
    labelPedido: 'Anulada',
    className: 'text-destructive bg-destructive/10 border-destructive/40',
    dot: 'bg-destructive',
  },
  abierta: {
    label: 'Abierta',
    labelPedido: 'Abierta',
    className: 'text-warning bg-warning/10 border-warning/40',
    dot: 'bg-warning',
  },
}

/**
 * Badge consistente para mostrar el estado de una venta/pedido.
 * 
 * En contexto 'pedido', "guardada" se muestra como "Pendiente"
 * (que es lo que ve el admin en el listado de pedidos).
 */
export function BadgeEstado({ estado, contexto = 'venta', className }: Props) {
  const data = map[estado as EstadoVenta] ?? {
    label: estado,
    labelPedido: estado,
    className: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  }

  const label = contexto === 'pedido' ? data.labelPedido : data.label

  return (
    <Badge variant="outline" className={cn('text-xs', data.className, className)}>
      <span className={cn('size-1.5 rounded-full mr-1.5', data.dot)} />
      {label}
    </Badge>
  )
}