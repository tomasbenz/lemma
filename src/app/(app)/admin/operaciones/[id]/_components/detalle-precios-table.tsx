'use client'

import * as React from 'react'
import Link from 'next/link'
import { Undo2 } from 'lucide-react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatARS } from '@/lib/format'
import type { DetalleOperacionPrecios } from '../_actions/obtener-detalle-precios'
import { DeshacerDialog } from './deshacer-dialog'

export function DetallePreciosTable({
  operacionId,
  detalle,
  esReversion,
}: {
  operacionId: string
  detalle: DetalleOperacionPrecios
  esReversion: boolean
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const titulo = esReversion ? 'Cambios revertidos' : 'Cambios de precio'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {titulo} ({detalle.total_filas})
        </h2>

        {/* Acción deshacer (solo en operaciones que NO son reversión) */}
        {!esReversion &&
          (detalle.ya_revertida ? (
            <p className="text-xs text-muted-foreground">
              Esta operación ya fue revertida
              {detalle.reversion_id && (
                <>
                  {' · '}
                  <Link
                    href={`/admin/operaciones/${detalle.reversion_id}`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    ver reversión
                  </Link>
                </>
              )}
            </p>
          ) : detalle.puede_deshacer ? (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Undo2 className="size-4 mr-1.5" />
              Deshacer aumento
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrapper para que el tooltip dispare aunque el botón esté disabled */}
                  <span tabIndex={0} className="inline-flex">
                    <Button variant="outline" size="sm" disabled>
                      <Undo2 className="size-4 mr-1.5" />
                      Deshacer aumento
                    </Button>
                  </span>
                </TooltipTrigger>
                {detalle.razon_no_deshacer && (
                  <TooltipContent>{detalle.razon_no_deshacer}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          ))}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Anterior</TableHead>
                <TableHead className="text-right">Nuevo</TableHead>
                <TableHead className="text-right w-20">Diff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detalle.filas.map((f) => (
                <TableRow key={f.producto_id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{f.producto_nombre}</span>
                      {f.producto_sku && (
                        <span className="text-[11px] text-muted-foreground font-numeric truncate">
                          {f.producto_sku}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-numeric tabular-nums text-muted-foreground">
                    {formatARS(f.precio_anterior)}
                  </TableCell>
                  <TableCell className="text-right font-numeric tabular-nums font-semibold">
                    {formatARS(f.precio_nuevo)}
                  </TableCell>
                  {/* Achromático: la diferencia va en gris, sin verde/rojo. */}
                  <TableCell className="text-right font-numeric tabular-nums text-xs text-muted-foreground">
                    {f.diff_porcentual > 0 ? '+' : ''}
                    {f.diff_porcentual}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <DeshacerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        operacionId={operacionId}
        cantidad={detalle.total_filas}
      />
    </section>
  )
}
