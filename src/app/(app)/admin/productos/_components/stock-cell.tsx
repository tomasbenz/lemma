'use client'

import { useState, useRef, useEffect } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { actualizarStock } from '../_actions/actualizar-stock'
import { formatAtributos } from '@/lib/format-atributos'

export type VarianteStock = {
  id: string
  atributos: Record<string, string>
  sku_variante: string | null
  stock: number
}

type StockCellProps = {
  productoId: string
  productoNombre: string
  trackStock: boolean
  variantesActivas: VarianteStock[]
  stockBajo?: number // umbral de stock bajo para pintar color
}

/**
 * Celda de stock editable para el listado de productos.
 *
 * - Sin track_stock → muestra "—"
 * - 1 variante (DEFAULT o única) → input inline
 * - N variantes → popover con todas las variantes editables
 */
export function StockCell({
  productoId,
  productoNombre,
  trackStock,
  variantesActivas,
  stockBajo = 5,
}: StockCellProps) {
  if (!trackStock) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  if (variantesActivas.length === 0) {
    return <span className="text-muted-foreground text-sm">Sin variantes</span>
  }

  // Una sola variante → input inline
  if (variantesActivas.length === 1) {
    return (
      <InlineStockEditor
        variante={variantesActivas[0]}
        stockBajo={stockBajo}
      />
    )
  }

  // Varias variantes → popover
  return (
    <VariantsStockPopover
      productoId={productoId}
      productoNombre={productoNombre}
      variantes={variantesActivas}
      stockBajo={stockBajo}
    />
  )
}

// ================================================================
// INLINE EDITOR (1 variante)
// ================================================================

function InlineStockEditor({
  variante,
  stockBajo,
}: {
  variante: VarianteStock
  stockBajo: number
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(variante.stock.toString())
  const [displayStock, setDisplayStock] = useState(variante.stock)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sincronizar si el prop cambia desde afuera (revalidate)
  useEffect(() => {
    if (!isEditing) {
      setDisplayStock(variante.stock)
      setValue(variante.stock.toString())
    }
  }, [variante.stock, isEditing])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  async function handleSave() {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Stock debe ser un número entero mayor o igual a 0')
      setValue(displayStock.toString())
      setIsEditing(false)
      return
    }

    if (parsed === displayStock) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    // Optimistic update
    const anterior = displayStock
    setDisplayStock(parsed)
    setIsEditing(false)

    const result = await actualizarStock([
      { varianteId: variante.id, stock: parsed },
    ])

    setIsSaving(false)

    if (!result.ok) {
      // Rollback
      setDisplayStock(anterior)
      setValue(anterior.toString())
      toast.error(result.error)
    } else {
      toast.success(`Stock actualizado: ${parsed}`)
    }
  }

  function handleCancel() {
    setValue(displayStock.toString())
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSave()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              handleCancel()
            }
          }}
          onBlur={handleSave}
          className="h-8 w-20 font-numeric"
          disabled={isSaving}
        />
      </div>
    )
  }

  const colorClass = cn(
    'font-numeric tabular-nums',
    displayStock === 0 && 'text-destructive font-semibold',
    displayStock > 0 && displayStock <= stockBajo && 'text-amber-600 font-medium'
  )

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 -ml-1.5 hover:bg-muted/60 transition-colors"
      title="Click para editar stock"
    >
      <span className={colorClass}>{displayStock}</span>
      <Pencil className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  )
}

// ================================================================
// POPOVER EDITOR (N variantes)
// ================================================================

function VariantsStockPopover({
  productoId: _productoId,
  productoNombre,
  variantes,
  stockBajo,
}: {
  productoId: string
  productoNombre: string
  variantes: VarianteStock[]
  stockBajo: number
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variantes.map((v) => [v.id, v.stock.toString()]))
  )
  const [displayVariantes, setDisplayVariantes] = useState(variantes)
  const [isSaving, setIsSaving] = useState(false)

  // Sincronizar cuando llega data fresca del server
  useEffect(() => {
    if (!open) {
      setDisplayVariantes(variantes)
      setValues(
        Object.fromEntries(variantes.map((v) => [v.id, v.stock.toString()]))
      )
    }
  }, [variantes, open])

  const total = displayVariantes.reduce((acc, v) => acc + v.stock, 0)

  const totalColorClass = cn(
    'font-numeric tabular-nums',
    total === 0 && 'text-destructive font-semibold',
    total > 0 && total <= stockBajo && 'text-amber-600 font-medium'
  )

  // Qué cambió
  const cambios = displayVariantes
    .map((v) => {
      const nuevo = parseInt(values[v.id] ?? '', 10)
      if (isNaN(nuevo) || nuevo < 0) return null
      if (nuevo === v.stock) return null
      return { varianteId: v.id, stock: nuevo }
    })
    .filter((x): x is { varianteId: string; stock: number } => x !== null)

  const hayErrores = displayVariantes.some((v) => {
    const parsed = parseInt(values[v.id] ?? '', 10)
    return isNaN(parsed) || parsed < 0
  })

  async function handleSave() {
    if (cambios.length === 0) {
      setOpen(false)
      return
    }

    if (hayErrores) {
      toast.error('Revisá los valores inválidos')
      return
    }

    setIsSaving(true)

    // Optimistic update
    const previas = displayVariantes
    const nuevas = displayVariantes.map((v) => {
      const nuevo = cambios.find((c) => c.varianteId === v.id)
      return nuevo ? { ...v, stock: nuevo.stock } : v
    })
    setDisplayVariantes(nuevas)

    const result = await actualizarStock(cambios)

    setIsSaving(false)

    if (!result.ok) {
      // Rollback
      setDisplayVariantes(previas)
      setValues(
        Object.fromEntries(previas.map((v) => [v.id, v.stock.toString()]))
      )
      toast.error(result.error)
    } else {
      toast.success(
        `${cambios.length} ${cambios.length === 1 ? 'variante actualizada' : 'variantes actualizadas'}`
      )
      setOpen(false)
    }
  }

  function handleCancel() {
    setValues(
      Object.fromEntries(
        displayVariantes.map((v) => [v.id, v.stock.toString()])
      )
    )
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 -ml-1.5 hover:bg-muted/60 transition-colors"
          title={`Editar stock de ${displayVariantes.length} variantes`}
        >
          <span className={totalColorClass}>{total}</span>
          <span className="text-xs text-muted-foreground">
            ({displayVariantes.length})
          </span>
          <Pencil className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-3 border-b">
          <p className="font-medium text-sm truncate" title={productoNombre}>
            {productoNombre}
          </p>
          <p className="text-xs text-muted-foreground">
            Editá el stock de cada variante
          </p>
        </div>

        <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
          {displayVariantes.map((v) => {
            const parsed = parseInt(values[v.id] ?? '', 10)
            const esInvalido =
              values[v.id] !== '' && (isNaN(parsed) || parsed < 0)

            const label = formatAtributos(v.atributos) || 'Variante única'

            return (
              <div key={v.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" title={label}>
                    {label}
                  </p>
                  {v.sku_variante && (
                    <p className="text-xs text-muted-foreground font-numeric truncate">
                      {v.sku_variante}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  min="0"
                  value={values[v.id] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [v.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !hayErrores) {
                      e.preventDefault()
                      handleSave()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      handleCancel()
                    }
                  }}
                  className={cn(
                    'h-8 w-20 font-numeric',
                    esInvalido &&
                      'border-destructive focus-visible:ring-destructive'
                  )}
                  disabled={isSaving}
                />
              </div>
            )
          })}
        </div>

        <div className="p-3 border-t flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {cambios.length === 0
              ? 'Sin cambios'
              : `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'}`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="size-3.5 mr-1" />
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || hayErrores || cambios.length === 0}
            >
              <Check className="size-3.5 mr-1" />
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}