// src/components/app/numeric-input.tsx
'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type NumericInputProps = Omit<
  React.ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  /** Valor numérico actual. null si está vacío y allowEmpty=true. */
  value: number | null
  /** Callback con el valor parseado. Recibe null si el campo queda vacío. */
  onChange: (value: number | null) => void
  /** Cantidad de decimales permitidos. 0 = solo enteros. Default 0. */
  decimals?: 0 | 1 | 2 | 3 | 4
  /** Mínimo permitido. Aplica clamping en blur. */
  min?: number
  /** Máximo permitido. Aplica clamping en blur. */
  max?: number
  /** Permite signos negativos. Default false. */
  allowNegative?: boolean
  /** Permite valor vacío (null). Si false, en blur vacío vuelve a 0. Default false. */
  allowEmpty?: boolean
  /**
   * Selecciona todo el contenido al hacer focus. Default false.
   *
   * En touch (tablet/mobile), seleccionar todo al focus es molesto: el usuario
   * toca para editar, todo queda seleccionado, y al tipear borra el contenido
   * existente. En desktop con teclado físico es útil para sobrescribir rápido.
   *
   * Activar SOLO en campos donde el usuario claramente va a sobrescribir el
   * valor entero (ej: monto principal en cobro/finalizar pedido).
   */
  selectOnFocus?: boolean
  /** Prefijo visual (ej: "$"). Renderizado dentro del input, no afecta valor. */
  prefix?: string
}

function isValidPartial(
  raw: string,
  decimals: number,
  allowNegative: boolean
): boolean {
  if (raw === '') return true
  if (allowNegative && raw === '-') return true
  // dígitos, opcionalmente coma o punto seguido de hasta `decimals` dígitos
  const sign = allowNegative ? '-?' : ''
  if (decimals === 0) {
    return new RegExp(`^${sign}\\d*$`).test(raw)
  }
  return new RegExp(`^${sign}\\d*([.,]\\d{0,${decimals}})?$`).test(raw)
}

function parseLocale(raw: string): number | null {
  if (raw === '' || raw === '-') return null
  // Quitar puntos (separadores de miles AR), reemplazar coma por punto decimal
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Formato para edición (mientras el input está enfocado): sin separadores de miles,
 * coma como decimal. Permite tipear naturalmente.
 * Ej: 570636.5 → "570636,5"
 */
function formatForEditing(value: number | null, decimals: number): string {
  if (value === null) return ''
  if (decimals === 0) return String(Math.trunc(value))
  const fixed = value.toFixed(decimals)
  return fixed.replace('.', ',')
}

/**
 * Formato para visualización (input sin foco): con separadores de miles AR.
 * Ej: 570636.5 → "570.636,50"
 *     1234567 → "1.234.567"
 *
 * IMPORTANTE: si el valor es 0 o null, devolvemos string vacío.
 * Esto hace que el campo muestre el placeholder en gris en lugar del "0".
 * El "0 fantasma" lo provee el placeholder del input.
 */
function formatForDisplay(value: number | null, decimals: number): string {
  if (value === null || value === 0) return ''
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Generar placeholder según los decimales del campo.
 * Ej: decimals=0 → "0", decimals=2 → "0,00"
 */
function placeholderPorDecimales(decimals: number): string {
  if (decimals === 0) return '0'
  return '0,' + '0'.repeat(decimals)
}

export function NumericInput({
  value,
  onChange,
  decimals = 0,
  min,
  max,
  allowNegative = false,
  allowEmpty = false,
  selectOnFocus = false,
  prefix,
  className,
  placeholder,
  onFocus,
  onBlur,
  onKeyDown,
  onWheel,
  ...rest
}: NumericInputProps) {
  // Estado interno como string para permitir estados intermedios ("12,", "-")
  // Sin foco: muestra con separadores de miles (o vacío si value=0/null)
  // Con foco: muestra sin separadores para edición fluida
  const [internal, setInternal] = React.useState<string>(() =>
    formatForDisplay(value, decimals)
  )
  const [focused, setFocused] = React.useState(false)

  // Si el valor externo cambia y NO estamos editando, sincronizar el display
  React.useEffect(() => {
    if (!focused) {
      setInternal(formatForDisplay(value, decimals))
    }
  }, [value, decimals, focused])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (!isValidPartial(raw, decimals, allowNegative)) return
    setInternal(raw)
    const parsed = parseLocale(raw)
    onChange(parsed)
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(true)
    // Cambiar de formato display (con separadores) a edición (sin separadores)
    // Si el valor es 0 o null, dejamos el campo vacío para tipear directo.
    if (value === null || value === 0) {
      setInternal('')
    } else {
      setInternal(formatForEditing(value, decimals))
    }
    if (selectOnFocus) {
      requestAnimationFrame(() => e.target.select())
    }
    onFocus?.(e)
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false)
    let parsed = parseLocale(internal)

    if (parsed === null) {
      if (!allowEmpty) {
        parsed = 0
      }
    } else {
      if (min !== undefined && parsed < min) parsed = min
      if (max !== undefined && parsed > max) parsed = max
      if (decimals === 0) {
        parsed = Math.trunc(parsed)
      } else {
        const factor = Math.pow(10, decimals)
        parsed = Math.round(parsed * factor) / factor
      }
    }

    // Al perder foco, formato con separadores de miles (o vacío si es 0/null)
    setInternal(formatForDisplay(parsed, decimals))
    onChange(parsed)
    onBlur?.(e)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
    }
    onKeyDown?.(e)
  }

  function handleWheel(e: React.WheelEvent<HTMLInputElement>) {
    if (focused) {
      ;(e.target as HTMLInputElement).blur()
    }
    onWheel?.(e)
  }

  const inputMode: React.HTMLAttributes<HTMLInputElement>['inputMode'] =
    decimals === 0 ? 'numeric' : 'decimal'

  // Placeholder por defecto: "0" o "0,00" según decimales.
  // Si el caller pasó uno explícito, ese gana.
  const placeholderFinal = placeholder ?? placeholderPorDecimales(decimals)

  if (prefix) {
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
          {prefix}
        </span>
        <Input
          {...rest}
          type="text"
          inputMode={inputMode}
          value={internal}
          placeholder={placeholderFinal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          className={cn('pl-7 font-numeric', className)}
        />
      </div>
    )
  }

  return (
    <Input
      {...rest}
      type="text"
      inputMode={inputMode}
      value={internal}
      placeholder={placeholderFinal}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      className={cn('font-numeric', className)}
    />
  )
}