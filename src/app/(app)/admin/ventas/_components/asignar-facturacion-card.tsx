// src/app/(app)/admin/ventas/_components/asignar-facturacion-card.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/app/numeric-input'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import { asignarFacturacion } from '../_actions/asignar-facturacion'

const PORCENTAJES_PRESET = [30, 50, 100] as const

type Props = {
  ventaId: string
  totalVenta: number
  /**
   * empresas.features.recargo_manual_habilitado. Si false, se ocultan los
   * presets 30/50/100 y el input queda fijado al total de la venta (no
   * se soporta facturación parcial). Default false (Lemma + Samu).
   */
  recargoManualHabilitado: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function AsignarFacturacionCard({
  ventaId,
  totalVenta,
  recargoManualHabilitado,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [montoFacturado, setMontoFacturado] = useState<number | null>(
    round2(totalVenta)
  )

  const porcentajeActivo: number | null = (() => {
    if (montoFacturado === null || montoFacturado <= 0) return null
    for (const p of PORCENTAJES_PRESET) {
      const esperado = round2((totalVenta * p) / 100)
      if (Math.abs(montoFacturado - esperado) < 0.01) return p
    }
    return null
  })()

  function aplicarPorcentaje(p: number) {
    setMontoFacturado(round2((totalVenta * p) / 100))
  }

  function handleSubmit() {
    if (!montoFacturado || montoFacturado <= 0) {
      toast.error('Ingresá el monto a facturar')
      return
    }
    if (montoFacturado > totalVenta + 0.01) {
      toast.error('El monto no puede superar el total de la venta')
      return
    }

    startTransition(async () => {
      const result = await asignarFacturacion({
        ventaId,
        tipoFactura: 'con_factura',
        montoFacturado,
      })

      if (!result.ok) {
        toast.error(result.error)
        router.refresh()
        return
      }

      toast.success(
        result.cae
          ? `Factura emitida. CAE ${result.cae}`
          : 'Facturación asignada'
      )
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          Asignar facturación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Esta venta fue cerrada sin facturación por la vendedora. Asigná el
          monto a facturar y se emite el comprobante en AFIP. El tipo (A o B)
          se deriva del cliente.
        </p>

        {/* Monto + presets (presets solo si recargoManualHabilitado) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="monto-facturado-asignar"
              className="text-sm font-medium"
            >
              Monto a facturar
            </Label>
            {recargoManualHabilitado && (
              <div className="flex items-center gap-1">
                {PORCENTAJES_PRESET.map((p) => {
                  const activo = porcentajeActivo === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => aplicarPorcentaje(p)}
                      disabled={isPending}
                      className={cn(
                        'rounded border px-2 py-0.5 text-[11px] font-medium font-numeric tabular-nums transition-colors',
                        activo
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                      )}
                    >
                      {p}%
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <NumericInput
            id="monto-facturado-asignar"
            value={montoFacturado}
            onChange={setMontoFacturado}
            decimals={2}
            min={0}
            allowEmpty
            prefix="$"
            placeholder="0,00"
            disabled={!recargoManualHabilitado}
          />

          {recargoManualHabilitado &&
            porcentajeActivo !== null &&
            porcentajeActivo < 100 && (
              <p className="text-[10px] text-muted-foreground">
                Facturando {porcentajeActivo}% del total ·{' '}
                {formatARS(totalVenta - (montoFacturado ?? 0))} sin facturar
              </p>
            )}

          <p className="text-[10px] text-muted-foreground">
            Total de la venta: {formatARS(totalVenta)}
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Emitiendo...
              </>
            ) : (
              <>
                <FileText className="size-4 mr-2" />
                Asignar y emitir
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
