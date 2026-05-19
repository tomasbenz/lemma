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
  mercadopago: 'Mercado Pago',
  tarjeta_credito: 'Tarjeta crédito',
  tarjeta_debito: 'Tarjeta débito',
  cheque: 'Cheque',
  otro: 'Otro',
}

// Paleta achromatic: solo tonos de foreground con opacidad variable.
// El medio con más volumen va con el tono más fuerte (lectura directa).
const COLORES: Record<string, string> = {
  efectivo: 'bg-foreground',
  transferencia: 'bg-foreground/75',
  mercadopago_qr: 'bg-foreground/55',
  mercadopago: 'bg-foreground/55',
  tarjeta_credito: 'bg-foreground/40',
  tarjeta_debito: 'bg-foreground/40',
  deposito: 'bg-foreground/25',
  cheque: 'bg-foreground/25',
  otro: 'bg-foreground/15',
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
        const label = LABELS[m.medio] ?? m.medio
        const color = COLORES[m.medio] ?? 'bg-foreground/15'
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
