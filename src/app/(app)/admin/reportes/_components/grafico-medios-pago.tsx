'use client'

import type { MedioPagoAgregado } from '@/lib/queries/reportes'
import { formatARS, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

type Props = {
  data: MedioPagoAgregado[]
}

const LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago_qr: 'Mercado Pago QR',
  otro: 'Otro',
}

const COLORES: Record<string, string> = {
  efectivo: 'bg-success/60',
  transferencia: 'bg-primary/60',
  deposito: 'bg-warning/60',
  mercadopago_qr: 'bg-accent-foreground/60',
  otro: 'bg-muted-foreground/60',
}

export function GraficoMediosPago({ data }: Props) {
  const total = data.reduce((acc, m) => acc + m.monto, 0)

  return (
    <div className="space-y-3">
      {data.map((m) => {
        const pct = total > 0 ? (m.monto / total) * 100 : 0
        const label = LABELS[m.medio] ?? m.medio
        const color = COLORES[m.medio] ?? 'bg-muted-foreground/60'

        return (
          <div key={m.medio} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className="font-numeric font-semibold">
                {formatARS(m.monto)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full transition-all', color)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground font-numeric w-16 text-right shrink-0">
                {pct.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(m.cantidad_transacciones)}{' '}
              {m.cantidad_transacciones === 1 ? 'transacción' : 'transacciones'}
            </p>
          </div>
        )
      })}
    </div>
  )
}