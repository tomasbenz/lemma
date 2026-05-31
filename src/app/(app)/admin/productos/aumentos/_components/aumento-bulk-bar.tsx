'use client'

import * as React from 'react'
import { X, ArrowUp, ArrowDown, Equal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { NumericInput } from '@/components/app/numeric-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  LABELS_REDONDEO,
  DEFAULT_REDONDEO,
  type EstrategiaRedondeo,
} from '@/lib/precios/redondeo'

export type TipoAccion = 'subir' | 'bajar' | 'fijar'

export type AccionAumento = {
  tipo: TipoAccion
  valor: number
  redondeo: EstrategiaRedondeo
}

const REDONDEOS: EstrategiaRedondeo[] = ['none', 'r10', 'r50', 'r100']

const TIPOS: { tipo: TipoAccion; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { tipo: 'subir', label: 'Subir %', icon: ArrowUp },
  { tipo: 'bajar', label: 'Bajar %', icon: ArrowDown },
  { tipo: 'fijar', label: 'Fijar precio', icon: Equal },
]

export function AumentoBulkBar({
  cantidad,
  onLimpiar,
  onRevisar,
  disabled,
}: {
  cantidad: number
  onLimpiar: () => void
  onRevisar: (accion: AccionAumento) => void
  disabled?: boolean
}) {
  const [tipo, setTipo] = React.useState<TipoAccion>('subir')
  const [valor, setValor] = React.useState<number | null>(null)
  const [redondeo, setRedondeo] = React.useState<EstrategiaRedondeo>(DEFAULT_REDONDEO)

  const esPorcentaje = tipo !== 'fijar'
  const maxValor = tipo === 'bajar' ? 99.99 : undefined

  const valorOk =
    valor !== null &&
    valor > 0 &&
    (tipo !== 'bajar' || valor < 100)

  function revisar() {
    if (!valorOk || valor === null) return
    onRevisar({ tipo, valor, redondeo })
  }

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 backdrop-blur px-4 py-3 shadow-lg ring-1 ring-foreground/5">
        <span className="text-sm font-medium font-numeric tabular-nums whitespace-nowrap">
          {cantidad} {cantidad === 1 ? 'seleccionado' : 'seleccionados'}
        </span>

        <div className="h-6 w-px bg-border" />

        {/* Tipo de acción */}
        <div className="inline-flex items-center rounded-md border bg-background p-0.5">
          {TIPOS.map((t) => (
            <button
              key={t.tipo}
              type="button"
              onClick={() => setTipo(t.tipo)}
              aria-pressed={tipo === t.tipo}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium',
                tipo === t.tipo
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Valor */}
        <NumericInput
          value={valor}
          onChange={setValor}
          decimals={2}
          min={0}
          max={maxValor}
          allowEmpty
          prefix={esPorcentaje ? undefined : '$'}
          placeholder={esPorcentaje ? '%' : '0,00'}
          className="h-9 w-28"
          aria-label={esPorcentaje ? 'Porcentaje' : 'Precio fijo'}
        />

        {/* Redondeo */}
        <Select
          value={redondeo}
          onValueChange={(v) => setRedondeo(v as EstrategiaRedondeo)}
        >
          <SelectTrigger size="sm" className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REDONDEOS.map((r) => (
              <SelectItem key={r} value={r}>
                {LABELS_REDONDEO[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={revisar} disabled={!valorOk || disabled}>
          Revisar cambios
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onLimpiar}
          aria-label="Limpiar selección"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
