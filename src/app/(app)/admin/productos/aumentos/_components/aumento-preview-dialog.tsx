'use client'

import * as React from 'react'
import { Loader2, AlertTriangle, Trash2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LABELS_REDONDEO, type EstrategiaRedondeo } from '@/lib/precios/redondeo'

export type PreviewRow = {
  id: string
  nombre: string
  marca_nombre: string | null
  precio_actual: number
  precio_nuevo: number
}

function difPct(actual: number, nuevo: number): string {
  if (actual <= 0) return '—'
  const d = ((nuevo - actual) / actual) * 100
  const r = Math.round(d * 10) / 10
  return `${r > 0 ? '+' : ''}${r}%`
}

export function AumentoPreviewDialog({
  open,
  onOpenChange,
  loading,
  rows,
  onQuitar,
  motivo,
  onMotivoChange,
  onAplicar,
  aplicando,
  accion,
  valor,
  redondeo,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  loading: boolean
  rows: PreviewRow[]
  onQuitar: (id: string) => void
  motivo: string
  onMotivoChange: (v: string) => void
  onAplicar: () => void
  aplicando: boolean
  /** Lo que pidió el usuario en la barra bulk (para mostrar contexto). */
  accion: 'subir' | 'bajar' | 'fijar'
  valor: number
  redondeo: EstrategiaRedondeo
}) {
  const [confirmMenores, setConfirmMenores] = React.useState(false)

  React.useEffect(() => {
    setConfirmMenores(false)
  }, [open])

  const hayMenores = rows.some((r) => r.precio_nuevo < r.precio_actual)
  const hayCero = rows.some((r) => r.precio_nuevo <= 0)
  const motivoOk = motivo.trim().length > 0 && motivo.trim().length <= 200

  const puedeAplicar =
    rows.length > 0 &&
    !hayCero &&
    motivoOk &&
    (!hayMenores || confirmMenores) &&
    !aplicando &&
    !loading

  // Lo que el usuario PIDIÓ (la columna "Dif." muestra el efecto real por fila
  // tras el redondeo, que puede no coincidir exacto con el % pedido).
  const descripcionAjuste =
    accion === 'subir'
      ? `Subir +${valor}%`
      : accion === 'bajar'
        ? `Bajar ${valor}%`
        : `Fijar precio a ${formatARS(valor)}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {loading
              ? 'Calculando…'
              : `Vas a actualizar ${rows.length} ${rows.length === 1 ? 'producto' : 'productos'}`}
          </DialogTitle>
          <DialogDescription>
            {descripcionAjuste} · Redondeo: {LABELS_REDONDEO[redondeo]}
          </DialogDescription>
        </DialogHeader>
        {!loading && (
          <p className="text-xs text-muted-foreground -mt-2">
            Revisá los precios nuevos. Podés quitar productos de la operación.
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {hayCero && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  Hay productos que quedarían en $0 por el redondeo. Quitalos
                  (o cancelá y cambiá el redondeo) para poder aplicar.
                </span>
              </div>
            )}

            <div className="rounded-lg border overflow-hidden">
              <div className="max-h-[50vh] overflow-y-auto no-scrollbar">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Producto</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Nuevo</TableHead>
                      <TableHead className="text-right w-16">Dif.</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const cero = r.precio_nuevo <= 0
                      const menor = r.precio_nuevo < r.precio_actual
                      return (
                        <TableRow key={r.id} className={cn(cero && 'bg-destructive/5')}>
                          <TableCell className="font-medium">
                            <span className="truncate">{r.nombre}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.marca_nombre ?? '—'}
                          </TableCell>
                          <TableCell className="text-right font-numeric tabular-nums text-muted-foreground">
                            {formatARS(r.precio_actual)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-numeric tabular-nums font-semibold',
                              cero && 'text-destructive'
                            )}
                          >
                            {formatARS(r.precio_nuevo)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-numeric tabular-nums text-xs',
                              menor ? 'text-destructive' : 'text-muted-foreground'
                            )}
                          >
                            {difPct(r.precio_actual, r.precio_nuevo)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => onQuitar(r.id)}
                              disabled={aplicando}
                              aria-label={`Quitar ${r.nombre}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Motivo */}
            <div className="space-y-1.5">
              <Label htmlFor="aumento-ws-motivo">Motivo</Label>
              <Input
                id="aumento-ws-motivo"
                value={motivo}
                onChange={(e) => onMotivoChange(e.target.value)}
                placeholder="Ej: Aumento Filgo junio · Liquidación temporada"
                maxLength={200}
                disabled={aplicando}
              />
              <p className="text-[11px] text-muted-foreground">
                Queda registrado en el historial de operaciones.
              </p>
            </div>

            {/* Confirmación si hay precios menores */}
            {hayMenores && (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm cursor-pointer">
                <Checkbox
                  checked={confirmMenores}
                  onCheckedChange={(v) => setConfirmMenores(v === true)}
                  disabled={aplicando}
                  className="mt-0.5"
                />
                <span className="text-destructive">
                  Confirmo que estoy aplicando precios MENORES a los actuales.
                </span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={aplicando}
          >
            Cancelar
          </Button>
          <Button onClick={onAplicar} disabled={!puedeAplicar}>
            {aplicando && <Loader2 className="size-4 mr-2 animate-spin" />}
            {aplicando ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
