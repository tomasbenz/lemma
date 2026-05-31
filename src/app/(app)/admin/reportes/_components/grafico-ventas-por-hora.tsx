'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatARS, formatNumber } from '@/lib/format'
import type { VentaPorHora } from '@/lib/queries/reportes'

type Props = {
  data: VentaPorHora[]
}

type Punto = {
  hora: number
  label: string
  monto: number
  transacciones: number
}

export function GraficoVentasPorHora({ data }: Props) {
  // Rellenamos las 24 horas para que el eje X sea continuo aunque la RPC
  // solo devuelva las horas con actividad.
  const porHora = new Map<number, VentaPorHora>()
  for (const d of data) porHora.set(d.hora, d)

  const completo: Punto[] = Array.from({ length: 24 }, (_, h) => {
    const existente = porHora.get(h)
    return {
      hora: h,
      label: `${String(h).padStart(2, '0')}h`,
      monto: existente?.monto ?? 0,
      transacciones: existente?.transacciones ?? 0,
    }
  })

  const hayDatos = data.some((d) => d.monto > 0 || d.transacciones > 0)

  return (
    <Card className="surface-1 enter-up">
      <CardHeader>
        <CardTitle className="text-base">Ventas por hora</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!hayDatos ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
            No hay ventas en este período.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={completo}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
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
                  cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null
                    const punto = payload[0].payload as Punto
                    return (
                      <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                        <p className="font-medium text-foreground">
                          Hora {punto.label}
                        </p>
                        <p className="text-muted-foreground font-numeric">
                          {formatARS(punto.monto)}
                        </p>
                        <p className="text-muted-foreground font-numeric">
                          {formatNumber(punto.transacciones)} transacciones
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar
                  dataKey="monto"
                  fill="var(--color-primary)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
