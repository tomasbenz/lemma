// src/app/(app)/admin/pedidos/[id]/_components/_items-table.tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatARS, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PedidoItem } from '@/lib/queries/pedidos'

export type ItemConProblemas = {
  item: PedidoItem
  problemas: string[]
}

type Props = {
  items: ItemConProblemas[]
}

/**
 * Tabla de items del pedido con indicador visual cuando un item tiene
 * problemas (stock insuficiente o variante desactivada).
 */
export function ItemsTable({ items }: Props) {
  return (
    <Card className="surface-1 enter-up stagger-1">
      <CardHeader>
        <CardTitle className="text-base">Items ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Producto</TableHead>
              <TableHead>Variante</TableHead>
              <TableHead className="text-center">Cant.</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(({ item, problemas }) => (
              <ItemRow key={item.id} item={item} problemas={problemas} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ItemRow({
  item,
  problemas,
}: {
  item: PedidoItem
  problemas: string[]
}) {
  const varianteLabel =
    [item.variante_color, item.variante_talle].filter(Boolean).join(' / ') ||
    '—'
  const tieneProblemas = problemas.length > 0

  return (
    <TableRow className={cn(tieneProblemas && 'bg-destructive/5')}>
      <TableCell className="text-sm font-medium">
        <div className="flex items-start gap-2">
          {tieneProblemas && (
            <AlertTriangle className="size-3.5 text-destructive shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p>{item.producto_nombre}</p>
            <p className="text-xs text-muted-foreground font-numeric">
              {item.variante_sku}
            </p>
            {tieneProblemas && (
              <p className="text-xs text-destructive mt-0.5">
                {problemas.join(' · ')}
              </p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {varianteLabel}
      </TableCell>
      <TableCell className="text-center font-numeric">
        {formatNumber(item.cantidad)}
      </TableCell>
      <TableCell className="text-right font-numeric">
        {formatARS(item.precio_unitario_neto)}
      </TableCell>
      <TableCell className="text-right font-numeric font-medium">
        {formatARS(item.subtotal_neto)}
      </TableCell>
    </TableRow>
  )
}