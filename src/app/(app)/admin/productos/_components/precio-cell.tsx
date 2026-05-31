'use client'

import { useState, useRef, useEffect } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import { actualizarPrecio } from '../_actions/actualizar-precio'

type Props = {
  productoId: string
  precioInicial: number
  /** Clase extra para el texto del precio (modo display, no edición). */
  displayClassName?: string
}

export function PrecioCell({
  productoId,
  precioInicial,
  displayClassName,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(precioInicial.toString())
  const [displayPrecio, setDisplayPrecio] = useState(precioInicial)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) {
      setDisplayPrecio(precioInicial)
      setValue(precioInicial.toString())
    }
  }, [precioInicial, isEditing])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  async function handleSave() {
    const parsed = parseFloat(value)
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Precio debe ser un número mayor o igual a 0')
      setValue(displayPrecio.toString())
      setIsEditing(false)
      return
    }

    const redondeado = Math.round(parsed * 100) / 100
    if (redondeado === displayPrecio) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    const anterior = displayPrecio
    setDisplayPrecio(redondeado)
    setIsEditing(false)

    const result = await actualizarPrecio(productoId, redondeado)
    setIsSaving(false)

    if (!result.ok) {
      setDisplayPrecio(anterior)
      setValue(anterior.toString())
      toast.error(result.error)
    } else {
      toast.success(`Precio actualizado: ${formatARS(redondeado)}`)
    }
  }

  function handleCancel() {
    setValue(displayPrecio.toString())
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        min="0"
        step="0.01"
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
        className="h-8 w-28 font-numeric text-right ml-auto"
        disabled={isSaving}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 -mr-1.5 hover:bg-muted/60 transition-colors ml-auto',
      )}
      title="Click para editar precio"
    >
      <span className={cn('font-numeric tabular-nums', displayClassName)}>
        {formatARS(displayPrecio)}
      </span>
      <Pencil className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  )
}
