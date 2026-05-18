'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Minus, Loader2, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import { ajustarStock } from '../_actions/ajustar-stock'

type Props = {
  varianteId: string
  stockActual: number
  productoNombre: string
  varianteLabel: string // "Blanco / M" o "REM-001-BLANCA-M"
  trigger?: React.ReactNode
}

type TipoAjuste = 'sumar' | 'restar'

const MOTIVOS_SUGERIDOS: Record<TipoAjuste, string[]> = {
  sumar: [
    'Ingreso de mercadería',
    'Devolución del cliente',
    'Ajuste de inventario físico',
    'Error de carga previa',
  ],
  restar: [
    'Rotura / daño',
    'Robo / pérdida',
    'Ajuste de inventario físico',
    'Uso interno',
    'Error de carga previa',
  ],
}

export function AjustarStockDialog({
  varianteId,
  stockActual,
  productoNombre,
  varianteLabel,
  trigger,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tipo, setTipo] = useState<TipoAjuste>('sumar')
  const [cantidad, setCantidad] = useState<string>('1')
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  const cant = parseInt(cantidad, 10)
  const cantValida = !isNaN(cant) && cant > 0
  const delta = tipo === 'sumar' ? cant : -cant
  const stockNuevoPrevisto = stockActual + delta
  const excedeMinimo = stockNuevoPrevisto < 0
  const formValido =
    cantValida && !excedeMinimo && motivo.trim().length >= 3

  function reset() {
    setTipo('sumar')
    setCantidad('1')
    setMotivo('')
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) reset()
  }

  function handleSubmit() {
    if (!formValido) return
    startTransition(async () => {
      const result = await ajustarStock(varianteId, delta, motivo)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Stock ajustado: ${result.stockAnterior} → ${result.stockNuevo}`
      )
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="size-3.5 mr-1.5" />
            Ajustar stock
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar stock</DialogTitle>
          <DialogDescription>
            {productoNombre} · {varianteLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stock actual */}
          <div className="rounded-md border p-3 bg-muted/30 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Stock actual</span>
            <span className="font-numeric text-lg font-semibold">
              {stockActual}
            </span>
          </div>

          {/* Sumar / Restar */}
          <div>
            <Label className="text-xs text-muted-foreground">Operación</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => setTipo('sumar')}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5',
                  tipo === 'sumar'
                    ? 'border-foreground bg-muted'
                    : 'border-border hover:border-foreground/40'
                )}
              >
                <Plus className="size-4" />
                Sumar
              </button>
              <button
                type="button"
                onClick={() => setTipo('restar')}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5',
                  tipo === 'restar'
                    ? 'border-foreground bg-muted'
                    : 'border-border hover:border-foreground/40'
                )}
              >
                <Minus className="size-4" />
                Restar
              </button>
            </div>
          </div>

          {/* Cantidad */}
          <div>
            <Label htmlFor="cantidad-ajuste" className="text-xs text-muted-foreground">
              Cantidad
            </Label>
            <Input
              id="cantidad-ajuste"
              type="number"
              min="1"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              onFocus={selectAllOnFocus}
              className="mt-1 font-numeric"
            />
          </div>

          {/* Preview */}
          {cantValida && (
            <div
              className={cn(
                'rounded-md border p-3 flex items-center justify-between text-sm',
                excedeMinimo
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-foreground/20 bg-muted/20'
              )}
            >
              <span className="text-muted-foreground">Stock después</span>
              <span
                className={cn(
                  'font-numeric text-lg font-semibold',
                  excedeMinimo && 'text-destructive'
                )}
              >
                {stockActual} {tipo === 'sumar' ? '+' : '−'} {cant} ={' '}
                {stockNuevoPrevisto}
              </span>
            </div>
          )}

          {excedeMinimo && (
            <p className="text-xs text-destructive">
              El stock no puede quedar negativo.
            </p>
          )}

          {/* Motivo */}
          <div>
            <Label htmlFor="motivo-ajuste" className="text-xs text-muted-foreground">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="motivo-ajuste"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onFocus={selectAllOnFocus}
              placeholder="Ej: Rotura durante manipuleo"
              maxLength={200}
              rows={2}
              className="mt-1"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {MOTIVOS_SUGERIDOS[tipo].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(m)}
                  className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-foreground/40 text-muted-foreground hover:text-foreground"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!formValido || isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Aplicando...
              </>
            ) : (
              'Aplicar ajuste'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}