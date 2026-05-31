'use client'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumericInput } from '@/components/app/numeric-input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Sentinela para representar "sin marca / sin categoría" en el Select (radix no
// permite value=""). En buildInput se mapea a null.
export const SIN_SELECCION = '__sin__'

/** Segmented toggle reusable (patrón aria-pressed igual que productos-view.tsx). */
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border bg-background p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'inline-flex items-center rounded-sm px-3 py-1.5 text-sm font-medium',
            value === o.value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Cambiar marca o categoría: Select con opción "sin …" + existentes (por id).
 * Reusable: el caller pasa el label y la lista de opciones {id, nombre}.
 */
export function FormCatalogoSelect({
  label,
  sinLabel,
  placeholder,
  opciones,
  value,
  onChange,
}: {
  label: string
  sinLabel: string
  placeholder: string
  opciones: { id: string; nombre: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SIN_SELECCION}>{sinLabel}</SelectItem>
          {opciones.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Precio fijo: NumericInput > 0 con prefix $. */
export function FormPrecioFijo({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div className="space-y-2">
      <Label>Nuevo precio</Label>
      <NumericInput
        value={value}
        onChange={onChange}
        decimals={2}
        min={0.01}
        allowEmpty
        prefix="$"
        placeholder="0.00"
      />
    </div>
  )
}

/** Precio %: Subir/Bajar + NumericInput positivo (signo se aplica en buildInput). */
export function FormPrecioPct({
  direccion,
  onDireccionChange,
  valor,
  onValorChange,
}: {
  direccion: 'subir' | 'bajar'
  onDireccionChange: (d: 'subir' | 'bajar') => void
  valor: number | null
  onValorChange: (v: number | null) => void
}) {
  const max = direccion === 'bajar' ? 100 : undefined
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Dirección</Label>
        <SegmentedToggle
          options={[
            { value: 'subir', label: 'Subir' },
            { value: 'bajar', label: 'Bajar' },
          ]}
          value={direccion}
          onChange={onDireccionChange}
          ariaLabel="Dirección del cambio de precio"
        />
      </div>
      <div className="space-y-2">
        <Label>Porcentaje</Label>
        <NumericInput
          value={valor}
          onChange={onValorChange}
          decimals={2}
          min={0}
          max={max}
          allowEmpty
          placeholder="0"
        />
      </div>
      {valor !== null && valor > 0 && (
        <p className="text-xs text-muted-foreground">
          Los precios actuales {direccion === 'subir' ? 'subirán' : 'bajarán'} un{' '}
          {valor}%.
        </p>
      )}
    </div>
  )
}

/** Ajustar stock: Modo + valor + motivo + aviso. */
export function FormStock({
  modo,
  onModoChange,
  valor,
  onValorChange,
  motivo,
  onMotivoChange,
}: {
  modo: 'sumar' | 'restar' | 'fijar'
  onModoChange: (m: 'sumar' | 'restar' | 'fijar') => void
  valor: number | null
  onValorChange: (v: number | null) => void
  motivo: string
  onMotivoChange: (m: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Modo</Label>
        <SegmentedToggle
          options={[
            { value: 'sumar', label: 'Sumar' },
            { value: 'restar', label: 'Restar' },
            { value: 'fijar', label: 'Fijar' },
          ]}
          value={modo}
          onChange={onModoChange}
          ariaLabel="Modo de ajuste de stock"
        />
      </div>
      <div className="space-y-2">
        <Label>{modo === 'fijar' ? 'Nuevo stock' : 'Cantidad'}</Label>
        <NumericInput
          value={valor}
          onChange={onValorChange}
          decimals={0}
          min={modo === 'fijar' ? 0 : 1}
          allowEmpty
          placeholder="0"
        />
      </div>
      <div className="space-y-2">
        <Label>Motivo</Label>
        <Input
          value={motivo}
          onChange={(e) => onMotivoChange(e.target.value)}
          placeholder="Ej: reposición de proveedor X"
          maxLength={200}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Solo se aplica a productos con una sola variante activa; el resto se omite.
      </p>
    </div>
  )
}
