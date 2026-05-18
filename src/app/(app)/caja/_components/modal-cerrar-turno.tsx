// src/app/(app)/caja/_components/modal-cerrar-turno.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LockKeyhole } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatARS } from '@/lib/format'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import {
  calcularDiferencia,
  diferenciaEsCero,
  validarMonto,
} from '@/lib/turnos/calculos'
import { cerrarTurno } from '../_actions/cerrar-turno'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  turnoId: string
  baseInicial: number
}

type Resumen = {
  total_efectivo_ventas: number
  total_teorico_efectivo: number
  totales_por_medio_pago: Array<{
    medio: string
    monto: number
    cantidad: number
  }>
  cantidad_ventas: number
}

const medioLabel: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  tarjeta_credito: 'Tarjeta crédito',
  tarjeta_debito: 'Tarjeta débito',
  cheque: 'Cheque',
  mercadopago: 'Mercado Pago',
  mercadopago_qr: 'Mercado Pago QR',
  otro: 'Otro',
}

export function ModalCerrarTurno({
  open,
  onOpenChange,
  turnoId,
  baseInicial,
}: Props) {
  const router = useRouter()
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [cargandoResumen, setCargandoResumen] = useState(false)
  const [totalDeclarado, setTotalDeclarado] = useState('')
  const [notaCierre, setNotaCierre] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setResumen(null)
      setTotalDeclarado('')
      setNotaCierre('')
      setSubmitting(false)
      setCargandoResumen(false)
      return
    }

    let cancelled = false
    setCargandoResumen(true)
    fetch(`/api/turnos/${turnoId}/resumen`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.ok) {
          setResumen(data.resumen)
        } else {
          toast.error(data?.error ?? 'No se pudo cargar el resumen')
        }
      })
      .catch(() => {
        if (cancelled) return
        toast.error('No se pudo cargar el resumen')
      })
      .finally(() => {
        if (!cancelled) setCargandoResumen(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, turnoId])

  const validacionDeclarado = validarMonto(totalDeclarado, 'Total declarado')
  const declaradoNumero = validacionDeclarado.ok ? validacionDeclarado.valor : null
  const teorico = resumen?.total_teorico_efectivo ?? null
  const diferencia =
    declaradoNumero !== null && teorico !== null
      ? calcularDiferencia(declaradoNumero, teorico)
      : null

  async function handleSubmit() {
    if (!validacionDeclarado.ok) {
      toast.error(validacionDeclarado.error)
      return
    }

    setSubmitting(true)
    const result = await cerrarTurno({
      turnoId,
      totalDeclarado: validacionDeclarado.valor,
      notaCierre: notaCierre.trim() || undefined,
    })

    if (!result.ok) {
      toast.error(result.error)
      setSubmitting(false)
      return
    }

    toast.success('Turno cerrado')
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-5" />
            Cerrar turno de caja
          </DialogTitle>
          <DialogDescription>
            Contá el efectivo en caja e ingresá el total. El sistema calcula
            la diferencia contra lo teórico.
          </DialogDescription>
        </DialogHeader>

        {cargandoResumen ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="size-4 animate-spin" />
            Cargando resumen del turno...
          </div>
        ) : resumen ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm font-numeric tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base inicial</span>
                <span>{formatARS(baseInicial)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Ventas en efectivo
                </span>
                <span>{formatARS(resumen.total_efectivo_ventas)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t font-semibold">
                <span>Teórico en caja</span>
                <span>{formatARS(resumen.total_teorico_efectivo)}</span>
              </div>
            </div>

            {resumen.totales_por_medio_pago.length > 0 && (
              <div className="rounded-md border p-3 space-y-1.5 text-xs font-numeric tabular-nums">
                <div className="text-muted-foreground uppercase tracking-wide text-[10px] font-medium pb-1">
                  Totales por medio
                </div>
                {resumen.totales_por_medio_pago.map((m) => (
                  <div key={m.medio} className="flex justify-between">
                    <span>
                      {medioLabel[m.medio] ?? m.medio}{' '}
                      <span className="text-muted-foreground">
                        ({m.cantidad})
                      </span>
                    </span>
                    <span>{formatARS(m.monto)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="total-declarado">
                Total contado en efectivo
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="total-declarado"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={totalDeclarado}
                  onChange={(e) => setTotalDeclarado(e.target.value)}
                  onFocus={selectAllOnFocus}
                  className="pl-7 font-numeric tabular-nums"
                  disabled={submitting}
                  autoFocus
                />
              </div>
            </div>

            {diferencia !== null && totalDeclarado.trim() !== '' && (
              <div
                className={
                  'rounded-md border p-3 text-sm font-numeric tabular-nums flex justify-between ' +
                  (diferenciaEsCero(diferencia)
                    ? 'bg-muted/30'
                    : 'border-foreground/30')
                }
              >
                <span className="text-muted-foreground">Diferencia</span>
                <span className="font-semibold">
                  {diferencia > 0 ? '+' : ''}
                  {formatARS(diferencia)}
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="nota-cierre">Nota de cierre (opcional)</Label>
              <Input
                id="nota-cierre"
                type="text"
                placeholder="Ej: motivo de la diferencia"
                value={notaCierre}
                onChange={(e) => setNotaCierre(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            No se pudo cargar el resumen.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || cargandoResumen || !resumen}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Cerrando...
              </>
            ) : (
              'Cerrar turno'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
