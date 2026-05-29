'use client'

import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'

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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatARS, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { FilaPreview } from '../_lib/calcular-preview'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  titulo: string
  subtitulo?: string
  filas: FilaPreview[]
  tipoValor: 'precio' | 'stock'
  onConfirmar: (overrides: Map<string, number>) => void
  loading: boolean
}

export function BulkPreviewDialog({
  open,
  onOpenChange,
  titulo,
  subtitulo,
  filas,
  tipoValor,
  onConfirmar,
  loading,
}: Props) {
  // Valores editados a mano (solo los que difieren del propuesto). Los inputs
  // son no-controlados (defaultValue + onBlur), así tipear NO re-renderiza la
  // tabla: el estado solo cambia en blur / revertir.
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map())
  // Token por fila para forzar remount del input (revertir / descartar inválido).
  const [revTokens, setRevTokens] = useState<Record<string, number>>({})

  function valorEfectivo(fila: FilaPreview): number {
    return overrides.get(fila.id) ?? fila.propuesto
  }

  function bumpRev(id: string) {
    setRevTokens((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }

  function parseValor(raw: string): number | null {
    const norm = raw.trim().replace(',', '.')
    if (norm === '') return null
    const n = Number(norm)
    if (!Number.isFinite(n)) return null
    if (tipoValor === 'precio') {
      return n > 0 ? Math.round(n * 100) / 100 : null
    }
    // stock: entero >= 0
    return Number.isInteger(n) && n >= 0 ? n : null
  }

  function handleBlur(fila: FilaPreview, raw: string) {
    const parsed = parseValor(raw)
    if (parsed === null) {
      // Inválido → descartar lo tipeado, volver al valor efectivo actual.
      bumpRev(fila.id)
      return
    }
    if (parsed === fila.propuesto) {
      if (overrides.has(fila.id)) {
        setOverrides((prev) => {
          const next = new Map(prev)
          next.delete(fila.id)
          return next
        })
      }
      return
    }
    setOverrides((prev) => new Map(prev).set(fila.id, parsed))
  }

  function revertir(fila: FilaPreview) {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(fila.id)
      return next
    })
    bumpRev(fila.id)
  }

  const aplicables = filas.filter((f) => !f.omitido).length
  const omitidos = filas.length - aplicables
  const manuales = overrides.size

  const esStock = tipoValor === 'stock'

  function formatVal(n: number): string {
    return esStock ? formatNumber(n) : formatARS(n)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {subtitulo && <DialogDescription>{subtitulo}</DialogDescription>}
        </DialogHeader>

        <div className="rounded-lg border overflow-hidden">
          <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
                <TableRow className="hover:bg-muted/50">
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">
                    {esStock ? 'Stock actual' : 'Precio actual'}
                  </TableHead>
                  {esStock && <TableHead className="text-center">Cambio</TableHead>}
                  <TableHead className="text-right w-40">
                    {esStock ? 'Stock nuevo' : 'Precio nuevo'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((fila) => {
                  const efectivo = valorEfectivo(fila)
                  const delta = efectivo - fila.actual
                  const esManual = overrides.has(fila.id)
                  const rev = revTokens[fila.id] ?? 0

                  return (
                    <TableRow
                      key={fila.id}
                      className={cn(fila.omitido && 'opacity-50')}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{fila.nombre}</span>
                          {fila.omitido && (
                            <Badge
                              variant="outline"
                              className="text-[10px] shrink-0"
                              title={fila.motivoOmision}
                            >
                              Se omitirá
                            </Badge>
                          )}
                          {esManual && !fila.omitido && (
                            <Badge
                              variant="outline"
                              className="text-[10px] shrink-0"
                            >
                              manual
                            </Badge>
                          )}
                        </div>
                        {fila.omitido && fila.motivoOmision && (
                          <p className="text-xs text-muted-foreground truncate">
                            {fila.motivoOmision}
                          </p>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-numeric tabular-nums">
                        {formatVal(fila.actual)}
                      </TableCell>

                      {esStock && (
                        <TableCell className="text-center font-numeric tabular-nums text-muted-foreground">
                          {fila.omitido
                            ? '—'
                            : delta === 0
                              ? '0'
                              : delta > 0
                                ? `+${formatNumber(delta)}`
                                : `−${formatNumber(Math.abs(delta))}`}
                        </TableCell>
                      )}

                      <TableCell className="text-right">
                        {fila.omitido ? (
                          <span className="font-numeric tabular-nums text-muted-foreground">
                            {formatVal(fila.actual)}
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              key={`${fila.id}-${rev}`}
                              type="text"
                              inputMode={esStock ? 'numeric' : 'decimal'}
                              defaultValue={String(efectivo)}
                              onBlur={(e) => handleBlur(fila, e.target.value)}
                              disabled={loading}
                              className="h-8 w-28 text-right font-numeric"
                            />
                            {esManual && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => revertir(fila)}
                                title="Revertir al valor propuesto"
                                disabled={loading}
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="sm:justify-between sm:items-center">
          <p className="text-xs text-muted-foreground">
            <span className="font-numeric tabular-nums">{aplicables}</span>{' '}
            {aplicables === 1 ? 'cambio' : 'cambios'}
            {manuales > 0 && (
              <>
                {' · '}
                <span className="font-numeric tabular-nums">{manuales}</span>{' '}
                {manuales === 1 ? 'manual' : 'manuales'}
              </>
            )}
            {omitidos > 0 && (
              <>
                {' · '}
                <span className="font-numeric tabular-nums">{omitidos}</span>{' '}
                {omitidos === 1 ? 'omitido' : 'omitidos'}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Volver
            </Button>
            <Button
              onClick={() => onConfirmar(overrides)}
              disabled={loading || aplicables === 0}
            >
              {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
              {loading ? 'Aplicando…' : `Confirmar ${aplicables} cambios`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
