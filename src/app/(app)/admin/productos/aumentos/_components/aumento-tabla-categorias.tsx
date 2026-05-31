'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { NumericInput } from '@/components/app/numeric-input'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { redondearPrecio, type EstrategiaRedondeo } from '@/lib/precios/redondeo'

export type FilaCategoria = {
  categoria_id: string
  nombre: string
  /** Productos activos en el scope (marca) actual. */
  n: number
  /** Promedio de precio_neto en el scope actual. */
  promActual: number
}

export function AumentoTablaCategorias({
  filas,
  pcts,
  redondeo,
  onPctChange,
}: {
  filas: FilaCategoria[]
  pcts: Record<string, number | null>
  redondeo: EstrategiaRedondeo
  onPctChange: (categoriaId: string, value: number | null) => void
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right w-24"># prod.</TableHead>
              <TableHead className="text-center w-32">% aumento</TableHead>
              <TableHead className="text-right w-44">
                Prom. actual → estimado
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => {
              const pct = pcts[f.categoria_id] ?? null
              const aplica = pct !== null && pct !== 0 && f.n > 0
              const estimado = aplica
                ? redondearPrecio(f.promActual * (1 + pct / 100), redondeo)
                : null
              const baja = pct !== null && pct < 0
              const quedaEnCero = estimado === 0 && f.promActual > 0

              return (
                <TableRow
                  key={f.categoria_id}
                  className={cn(f.n === 0 && 'opacity-50')}
                >
                  <TableCell className="font-medium">{f.nombre}</TableCell>
                  <TableCell className="text-right font-numeric tabular-nums text-muted-foreground">
                    {f.n}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <NumericInput
                        value={pct}
                        onChange={(v) => onPctChange(f.categoria_id, v)}
                        decimals={2}
                        min={-99.99}
                        allowNegative
                        allowEmpty
                        disabled={f.n === 0}
                        placeholder="0"
                        className="h-8 w-20 text-right"
                        aria-label={`Porcentaje para ${f.nombre}`}
                      />
                      <span className="text-muted-foreground text-sm">%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-numeric tabular-nums">
                    {f.n === 0 ? (
                      <span className="text-muted-foreground">sin productos</span>
                    ) : aplica ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5',
                          quedaEnCero && 'text-destructive'
                        )}
                      >
                        <span className="text-muted-foreground">
                          {formatARS(f.promActual)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className={cn('font-semibold', baja && 'text-destructive')}>
                          {formatARS(estimado)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {formatARS(f.promActual)} · sin cambio
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
