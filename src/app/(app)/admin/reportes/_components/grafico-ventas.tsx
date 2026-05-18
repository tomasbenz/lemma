'use client'

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { VentaPorDia } from '@/lib/queries/reportes'
import { formatARS } from '@/lib/format'

type Props = {
  data: VentaPorDia[]
}

export function GraficoVentas({ data }: Props) {
  const formatted = data.map((d) => {
    const fecha = new Date(d.fecha + 'T12:00:00')
    return {
      ...d,
      labelFecha: fecha.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
      }),
    }
  })

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
        No hay ventas en este período.
      </div>
    )
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={formatted}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorMonto" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-primary)"
                stopOpacity={0.4}
              />
              <stop
                offset="95%"
                stopColor="var(--color-primary)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="labelFecha"
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => {
              if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
              if (v >= 1_000) return `$${Math.round(v / 1_000)}k`
              return `$${v}`
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'var(--color-foreground)' }}
            formatter={(value, name) => {
              const n = typeof value === 'number' ? value : Number(value ?? 0)
              if (name === 'monto') return [formatARS(n), 'Facturado']
              return [String(n), String(name)]
            }}
          />
          <Area
            type="monotone"
            dataKey="monto"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#colorMonto)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}