'use client'

import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatARS, formatNumber } from '@/lib/format'
import type { MarcaRanking } from '@/lib/queries/reportes'

import { BotonExportarTabla } from './boton-exportar-tabla'

type Props = {
  filas: MarcaRanking[]
}

/**
 * Ranking de marcas por monto facturado. El "% del total" se calcula acá
 * sobre la suma de montos de las filas recibidas.
 */
export function TablaRankingMarcas({ filas }: Props) {
  const totalMonto = filas.reduce((acc, f) => acc + f.monto, 0)

  const pct = (monto: number): string => {
    if (totalMonto <= 0) return '—'
    return `${((monto / totalMonto) * 100).toFixed(1)}%`
  }

  const colsExport = [
    { key: 'marca_nombre', label: 'Marca' },
    { key: 'monto', label: 'Monto' },
    { key: 'unidades', label: 'Unidades' },
    { key: 'pct', label: '% del total' },
  ]
  const filasExport: Record<string, unknown>[] = filas.map((f) => ({
    marca_nombre: f.marca_nombre,
    monto: f.monto,
    unidades: f.unidades,
    pct: pct(f.monto),
  }))

  return (
    <Card className="surface-1 enter-up">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Marcas</CardTitle>
        <BotonExportarTabla
          columnas={colsExport}
          filas={filasExport}
          nombreArchivo="lemma-marcas"
          nombreHoja="Marcas"
          disabled={filas.length === 0}
        />
      </CardHeader>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Sin datos en el período.
        </p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Marca</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">% del total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila, i) => (
                <TableRow key={`${fila.marca_id ?? 'sin'}-${i}`}>
                  <TableCell className="font-medium">
                    {fila.marca_nombre}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {formatARS(fila.monto)}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {formatNumber(fila.unidades)}
                  </TableCell>
                  <TableCell className="text-right font-numeric text-muted-foreground">
                    {pct(fila.monto)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
