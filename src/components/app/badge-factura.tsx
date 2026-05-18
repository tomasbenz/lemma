// src/components/app/badge-factura.tsx
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Database } from '@/types/database'

export type TipoFactura = Database['public']['Enums']['tipo_factura']

type Props = {
  tipo: TipoFactura | string
  className?: string
}

const map: Record<TipoFactura, { label: string; className: string }> = {
  sin_factura: {
    label: 'Sin factura',
    className: 'text-muted-foreground',
  },
  factura_a: {
    label: 'Factura A',
    className: 'text-primary border-primary/40 bg-primary/10',
  },
  factura_b: {
    label: 'Factura B',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
  factura_c: {
    // Label literal — este componente es generico, no aplica el hack
    // de "Factura C → mostrar como Factura B" que si hace page.tsx.
    label: 'Factura C',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
  nota_credito_a: {
    label: 'NC A',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
  nota_credito_b: {
    label: 'NC B',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
  nota_debito_a: {
    label: 'ND A',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
  nota_debito_b: {
    label: 'ND B',
    className: 'text-foreground border-foreground/30 bg-muted',
  },
}

/**
 * Badge consistente para mostrar el tipo de factura emitida.
 */
export function BadgeFactura({ tipo, className }: Props) {
  const data = map[tipo as TipoFactura] ?? {
    label: tipo,
    className: 'text-muted-foreground',
  }
  return (
    <Badge variant="outline" className={cn('text-xs', data.className, className)}>
      {data.label}
    </Badge>
  )
}
