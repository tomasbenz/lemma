'use client'

import type { MedioPagoAgregado } from '@/lib/queries/reportes'
import { formatARS, formatNumber } from '@/lib/format'
import { labelMedioPago, colorMedioPago } from '@/lib/medios-pago'
import { cn } from '@/lib/utils'

type Props = {
  data: MedioPagoAgregado[]
}

export function GraficoMediosPago({ data }: Props) {
  // Excluir medios sin transacciones (defensa: el caller normalmente
  // ya filtra, pero por las dudas).
  const filas = data.filter((m) => m.cantidad_transacciones > 0)
  const total = filas.reduce((acc, m) => acc + m.monto, 0)

  return (
    <div className="space-y-3">
      {filas.map((m) => {
        const pct = total > 0 ? (m.monto / total) * 100 : 0
        const label = labelMedioPago(m.medio)
        const color = colorMedioPago(m.medio)
        const ticketPromedio =
          m.cantidad_transacciones > 0 ? m.monto / m.cantidad_transacciones : 0

        return (
          <div key={m.medio} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className="flex items-center gap-3 font-numeric">
                <span className="font-semibold">{formatARS(m.monto)}</span>
                <span className="text-muted-foreground text-xs w-14 text-right">
                  {pct.toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full transition-all', color)}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground font-numeric">
              {formatNumber(m.cantidad_transacciones)}{' '}
              {m.cantidad_transacciones === 1 ? 'transacción' : 'transacciones'}
              {' · '}ticket promedio {formatARS(ticketPromedio)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
