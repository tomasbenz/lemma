'use client'

import * as React from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { formatARS } from '@/lib/format'
import { LABELS_REDONDEO, type EstrategiaRedondeo } from '@/lib/precios/redondeo'
import type { PreviewAumentoResultado } from '../_actions/preview-aumento'

type PreviewOk = Extract<PreviewAumentoResultado, { ok: true }>

export function AumentoPreviewDialog({
  open,
  onOpenChange,
  loading,
  error,
  preview,
  redondeo,
  motivo,
  onMotivoChange,
  onAplicar,
  aplicando,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  loading: boolean
  error: string | null
  preview: PreviewOk | null
  redondeo: EstrategiaRedondeo
  motivo: string
  onMotivoChange: (v: string) => void
  onAplicar: () => void
  aplicando: boolean
}) {
  const [confirmNegativos, setConfirmNegativos] = React.useState(false)

  // Resetear el check cuando se abre/cierra o cambia el preview.
  React.useEffect(() => {
    setConfirmNegativos(false)
  }, [open, preview])

  const hayNegativos = preview?.hay_negativos ?? false
  const motivoOk = motivo.trim().length > 0 && motivo.trim().length <= 200
  const puedeAplicar =
    !!preview &&
    preview.total_afectados > 0 &&
    motivoOk &&
    (!hayNegativos || confirmNegativos) &&
    !aplicando

  const categoriasConCambio = preview
    ? preview.por_categoria.filter((c) => c.n_productos > 0)
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar aumento</DialogTitle>
          <DialogDescription>
            Revisá el impacto antes de aplicar. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Calculando preview…
          </div>
        ) : error ? (
          <div className="py-6 text-sm text-destructive">{error}</div>
        ) : preview ? (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="text-sm">
              Vas a afectar{' '}
              <span className="font-semibold font-numeric tabular-nums">
                {preview.total_afectados}
              </span>{' '}
              {preview.total_afectados === 1 ? 'producto' : 'productos'} en{' '}
              <span className="font-semibold font-numeric tabular-nums">
                {categoriasConCambio.length}
              </span>{' '}
              {categoriasConCambio.length === 1 ? 'categoría' : 'categorías'}.
            </div>

            {/* Avisos */}
            {preview.productos_sin_categoria_en_scope > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.productos_sin_categoria_en_scope}{' '}
                {preview.productos_sin_categoria_en_scope === 1
                  ? 'producto sin categoría no se verá afectado'
                  : 'productos sin categoría no se verán afectados'}
                .
              </p>
            )}
            {preview.hay_riesgo_cero && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>
                  Con redondeo {LABELS_REDONDEO[redondeo]}, algunos productos
                  baratos quedarían en $0. Revisá los ejemplos o cambiá el
                  redondeo.
                </span>
              </div>
            )}

            {/* Desglose por categoría */}
            <div className="rounded-lg border divide-y max-h-56 overflow-y-auto no-scrollbar">
              {categoriasConCambio.map((c) => (
                <div
                  key={c.categoria_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="truncate font-medium">
                      {c.categoria_nombre}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {c.pct > 0 ? `+${c.pct}` : c.pct}%
                    </Badge>
                    {c.riesgo_cero && (
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0 border-destructive/50 text-destructive"
                      >
                        riesgo $0
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-numeric tabular-nums">
                    <span className="text-muted-foreground text-xs">
                      {c.n_productos} prod.
                    </span>
                    <span className="text-muted-foreground">
                      {formatARS(c.prom_actual)}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-semibold">
                      {formatARS(c.prom_estimado)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Ejemplos */}
            {preview.ejemplos.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Ver ejemplos ({preview.ejemplos.length})
                </summary>
                <div className="mt-2 rounded-lg border divide-y max-h-48 overflow-y-auto no-scrollbar">
                  {preview.ejemplos.map((e) => (
                    <div
                      key={e.producto_id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                    >
                      <span className="truncate">{e.nombre}</span>
                      <div className="flex items-center gap-1.5 shrink-0 font-numeric tabular-nums">
                        <span className="text-muted-foreground">
                          {formatARS(e.precio_actual)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span
                          className={
                            e.precio_estimado === 0 ? 'text-destructive font-semibold' : 'font-semibold'
                          }
                        >
                          {formatARS(e.precio_estimado)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Motivo */}
            <div className="space-y-1.5">
              <Label htmlFor="aumento-motivo">Motivo</Label>
              <Input
                id="aumento-motivo"
                value={motivo}
                onChange={(e) => onMotivoChange(e.target.value)}
                placeholder="Ej: Suba proveedor Filgo 28-may"
                maxLength={200}
                disabled={aplicando}
              />
              <p className="text-[11px] text-muted-foreground">
                Queda registrado en el historial de operaciones.
              </p>
            </div>

            {/* Confirmación extra si hay descuentos */}
            {hayNegativos && (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm cursor-pointer">
                <Checkbox
                  checked={confirmNegativos}
                  onCheckedChange={(v) => setConfirmNegativos(v === true)}
                  disabled={aplicando}
                  className="mt-0.5"
                />
                <span className="text-destructive">
                  Confirmo que quiero APLICAR DESCUENTOS (algunos porcentajes son
                  negativos).
                </span>
              </label>
            )}
          </div>
        ) : null}

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
            {aplicando ? 'Aplicando…' : 'Aplicar aumento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
