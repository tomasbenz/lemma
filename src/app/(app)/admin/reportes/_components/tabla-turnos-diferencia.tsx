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
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import type { TurnoDiferencia } from '@/lib/queries/reportes'

import { BotonExportarTabla } from './boton-exportar-tabla'

type Props = {
  filas: TurnoDiferencia[]
}

// Fecha del cierre (o apertura si todavía no cerró) en formato dd/MM/yy HH:mm.
function formatFecha(turno: TurnoDiferencia): string {
  const iso = turno.cerrado_at ?? turno.abierto_at
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Diferencia con signo explícito: + sobra, - falta.
function formatDiferenciaConSigno(diff: number): string {
  const base = formatARS(Math.abs(diff))
  if (diff > 0) return `+${base}`
  if (diff < 0) return `-${base}`
  return base
}

/**
 * Turnos cuyo arqueo no cuadró. Una lista vacía es buena noticia (cero
 * diferencias), no un error — el texto lo refleja.
 */
export function TablaTurnosDiferencia({ filas }: Props) {
  const colsExport = [
    { key: 'fecha', label: 'Fecha' },
    { key: 'vendedor', label: 'Vendedor' },
    { key: 'base_inicial', label: 'Base' },
    { key: 'total_declarado', label: 'Declarado' },
    { key: 'diferencia', label: 'Diferencia' },
  ]
  const filasExport: Record<string, unknown>[] = filas.map((f) => ({
    fecha: formatFecha(f),
    vendedor: f.vendedor ?? '—',
    base_inicial: f.base_inicial,
    total_declarado: f.total_declarado ?? '',
    diferencia: f.diferencia,
  }))

  return (
    <Card className="surface-1 enter-up">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          Turnos con diferencia de caja
        </CardTitle>
        <BotonExportarTabla
          columnas={colsExport}
          filas={filasExport}
          nombreArchivo="lemma-turnos-diferencia"
          nombreHoja="Turnos"
          disabled={filas.length === 0}
        />
      </CardHeader>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Sin diferencias de caja en el período.
        </p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Declarado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila) => (
                <TableRow key={fila.id}>
                  <TableCell className="font-numeric">
                    {formatFecha(fila)}
                  </TableCell>
                  <TableCell className="truncate max-w-[200px]">
                    {fila.vendedor ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {formatARS(fila.base_inicial)}
                  </TableCell>
                  <TableCell className="text-right font-numeric">
                    {fila.total_declarado === null
                      ? '—'
                      : formatARS(fila.total_declarado)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-numeric font-medium',
                      fila.diferencia < 0 && 'text-destructive',
                      fila.diferencia > 0 && 'text-success'
                    )}
                  >
                    {formatDiferenciaConSigno(fila.diferencia)}
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
