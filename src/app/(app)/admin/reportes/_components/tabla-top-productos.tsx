'use client'

import {
  Card,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatARS, formatNumber } from '@/lib/format'

import { BotonExportarTabla } from './boton-exportar-tabla'

type ColumnaProducto = 'unidades' | 'monto' | 'margen' | 'stock_total'

type FilaProducto = {
  producto_nombre: string
  producto_sku: string
  monto?: number
  unidades?: number
  margen?: number
  stock_total?: number | null
}

type Props = {
  titulo: string
  filas: FilaProducto[]
  columnas: ColumnaProducto[]
  vacioTexto?: string
}

const LABEL_COLUMNA: Record<ColumnaProducto, string> = {
  unidades: 'Unidades',
  monto: 'Monto',
  margen: 'Margen',
  stock_total: 'Stock',
}

// Las columnas de plata van con formatARS; las discretas con formatNumber.
const ES_MONETARIA: Record<ColumnaProducto, boolean> = {
  unidades: false,
  monto: true,
  margen: true,
  stock_total: false,
}

function formatValor(col: ColumnaProducto, fila: FilaProducto): string {
  const valor = fila[col]
  if (valor === null || valor === undefined) return '—'
  return ES_MONETARIA[col] ? formatARS(valor) : formatNumber(valor)
}

/**
 * Tabla reutilizable para top_monto / top_cantidad / margen_negativo /
 * dormidos. Siempre muestra Producto (nombre + sku) y luego una columna por
 * cada entry de `columnas`. El botón de exportar deriva sus datos de lo que
 * se muestra: Producto + SKU + columnas.
 */
export function TablaTopProductos({
  titulo,
  filas,
  columnas,
  vacioTexto,
}: Props) {
  const colsExport = [
    { key: 'producto_nombre', label: 'Producto' },
    { key: 'producto_sku', label: 'SKU' },
    ...columnas.map((c) => ({ key: c, label: LABEL_COLUMNA[c] })),
  ]

  const filasExport: Record<string, unknown>[] = filas.map((f) => {
    const obj: Record<string, unknown> = {
      producto_nombre: f.producto_nombre,
      producto_sku: f.producto_sku,
    }
    for (const c of columnas) obj[c] = f[c] ?? ''
    return obj
  })

  return (
    <Card className="surface-1 enter-up">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <BotonExportarTabla
          columnas={colsExport}
          filas={filasExport}
          nombreArchivo={`lemma-${titulo
            .toLowerCase()
            .replace(/\s+/g, '-')}`}
          nombreHoja={titulo.slice(0, 31)}
          disabled={filas.length === 0}
        />
      </CardHeader>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {vacioTexto ?? 'Sin datos en el período.'}
        </p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                {columnas.map((c) => (
                  <TableHead key={c} className="text-right">
                    {LABEL_COLUMNA[c]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((fila, i) => (
                <TableRow key={`${fila.producto_sku}-${i}`}>
                  <TableCell>
                    <p className="font-medium truncate max-w-[280px]">
                      {fila.producto_nombre}
                    </p>
                    <p className="text-xs text-muted-foreground font-numeric truncate">
                      {fila.producto_sku}
                    </p>
                  </TableCell>
                  {columnas.map((c) => {
                    const margenNegativo =
                      c === 'margen' &&
                      typeof fila.margen === 'number' &&
                      fila.margen < 0
                    return (
                      <TableCell
                        key={c}
                        className={cn(
                          'text-right font-numeric',
                          margenNegativo && 'text-destructive'
                        )}
                      >
                        {formatValor(c, fila)}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}
