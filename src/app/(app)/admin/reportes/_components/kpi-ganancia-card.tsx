'use client'

import { TrendingUp } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import type { GananciaReporte } from '@/lib/queries/reportes'

type Props = {
  ganancia: GananciaReporte
}

/**
 * Card destacada de ganancia estimada. Mismo estilo que las KpiCard de
 * reportes-view (surface-1, ícono arriba). Aclara cobertura debajo porque
 * el cálculo depende de cuántos items tienen costo cargado.
 */
export function KpiGananciaCard({ ganancia }: Props) {
  const negativo = ganancia.monto < 0

  return (
    <Card className="surface-1 enter-up border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Ganancia</span>
        </div>
        <p
          className={cn(
            'text-xl md:text-2xl font-bold font-numeric truncate',
            negativo && 'text-destructive'
          )}
        >
          {formatARS(ganancia.monto)}
        </p>
        <p className="text-xs text-muted-foreground">
          Calculado con costo actual · sobre {ganancia.cobertura_pct}% de items
          con costo
        </p>
      </CardContent>
    </Card>
  )
}
