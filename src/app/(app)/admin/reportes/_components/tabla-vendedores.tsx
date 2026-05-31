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
import type { VendedorReporte } from '@/lib/queries/reportes'

import { BotonExportarTabla } from './boton-exportar-tabla'

type Props = {
  filas: VendedorReporte[]
}

/**
 * Ventas agregadas por vendedor. El ticket promedio se calcula acá
 * (monto / transacciones); con 0 transacciones mostramos "—".
 */
export function TablaVendedores({ filas }: Props) {
  const ticket = (f: VendedorReporte): string =>
    f.transacciones > 0 ? formatARS(f.monto / f.transacciones) : '—'

  const colsExport = [
    { key: 'nombre_completo', label: 'Vendedor' },
    { key: 'transacciones', label: 'Transacciones' },
    { key: 'monto', label: 'Monto' },
    { key: 'ticket', label: 'Ticket promedio' },
  ]
  const filasExport: Record<string, unknown>[] = filas.map((f) => ({
    nombre_completo: f.nombre_completo,
    transacciones: f.transacciones,
    monto: f.monto,
    ticket: ticket(f),
  }))

  return (
    <Card className="surface-1 enter-up">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Ventas por vendedor</CardTitle>
        <BotonExportarTabla
          columnas={colsExport}
          filas={filasExport}
          nombreArchivo="lemma-vendedores"
          nombreHoja="Vendedores"
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
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Transacciones</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Ticket promedio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila) => (
                <TableRow key={fila.usuario_id}>
                  <TableCell className="font-medium truncate max-w-[240px]">
                    {fila.nombre_completo}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {formatNumber(fila.transacciones)}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {formatARS(fila.monto)}
                  </TableCell>
                  <TableCell className="text-right font-numeric text-muted-foreground">
                    {ticket(fila)}
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
