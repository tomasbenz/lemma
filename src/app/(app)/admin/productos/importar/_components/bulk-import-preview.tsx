'use client'

import { Loader2 } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FilaDiff, ColumnaDiff } from '../../_lib/excel-productos'

const LABELS: Record<ColumnaDiff, string> = {
  precio_neto: 'Precio',
  marca: 'Marca',
  categoria: 'Categoría',
  stock: 'Stock',
  activo: 'Activo prod.',
  activa: 'Activa var.',
  codigo_barras: 'Cód. barras',
}

const ORDEN: ColumnaDiff[] = [
  'precio_neto',
  'marca',
  'categoria',
  'stock',
  'activo',
  'activa',
  'codigo_barras',
]

export function BulkImportPreview({
  filas,
  cambiosCount,
  onConfirmar,
  onCancelar,
  loading,
}: {
  filas: FilaDiff[]
  cambiosCount: number
  onConfirmar: () => void
  onCancelar: () => void
  loading: boolean
}) {
  // Columnas visibles: solo las que tienen al menos un cambio real en alguna fila.
  const columnasVisibles = ORDEN.filter((col) =>
    filas.some((f) => !f.omitido && f.celdas[col]?.cambio)
  )

  const omitidos = filas.filter((f) => f.omitido).length

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
              <TableRow className="hover:bg-muted/50">
                <TableHead>Producto</TableHead>
                {columnasVisibles.map((col) => (
                  <TableHead key={col} className="text-right">
                    {LABELS[col]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f) => (
                <TableRow
                  key={f.sku_variante}
                  className={cn(f.omitido && 'opacity-50')}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{f.nombre}</span>
                      {f.omitido && (
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0"
                          title={f.motivo}
                        >
                          Se omitirá
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-numeric truncate">
                      {f.sku_variante}
                      {f.omitido && f.motivo ? ` · ${f.motivo}` : ''}
                    </p>
                  </TableCell>

                  {columnasVisibles.map((col) => {
                    const celda = f.celdas[col]
                    if (!celda) {
                      return (
                        <TableCell
                          key={col}
                          className="text-right text-muted-foreground"
                        >
                          —
                        </TableCell>
                      )
                    }
                    return (
                      <TableCell
                        key={col}
                        className={cn(
                          'text-right font-numeric tabular-nums',
                          celda.cambio
                            ? 'bg-muted/40 font-medium'
                            : 'text-muted-foreground'
                        )}
                        title={celda.cambio ? `Antes: ${celda.actual}` : undefined}
                      >
                        {celda.cambio ? (
                          <span>
                            <span className="text-muted-foreground line-through mr-1">
                              {celda.actual}
                            </span>
                            {celda.nuevo}
                          </span>
                        ) : (
                          celda.nuevo
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-numeric tabular-nums">{cambiosCount}</span>{' '}
          {cambiosCount === 1 ? 'cambio' : 'cambios'}
          {omitidos > 0 && (
            <>
              {' · '}
              <span className="font-numeric tabular-nums">{omitidos}</span>{' '}
              {omitidos === 1 ? 'omitido' : 'omitidos'}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancelar} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={loading || cambiosCount === 0}>
            {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
            {loading ? 'Aplicando…' : `Confirmar ${cambiosCount} cambios`}
          </Button>
        </div>
      </div>
    </div>
  )
}
