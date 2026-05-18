// src/components/app/fecha-corta.tsx
'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  fecha: string
  /** Si es true, muestra fecha y hora en 2 líneas. Default true. */
  conHora?: boolean
  className?: string
}

/**
 * Renderiza una fecha en formato compacto (ej: "25/04/26" + "14:30")
 * solo en cliente para evitar mismatches de hidratación.
 * En SSR muestra el formato más simple posible.
 */
export function FechaCorta({ fecha, conHora = true, className }: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const d = new Date(fecha)

  if (!mounted) {
    // Fallback estable para SSR
    const iso = fecha.slice(0, 10)
    return (
      <span className={cn('font-numeric', className)} suppressHydrationWarning>
        {iso}
      </span>
    )
  }

  const fechaStr = d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })

  if (!conHora) {
    return <span className={cn('font-numeric', className)}>{fechaStr}</span>
  }

  const horaStr = d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={cn('flex flex-col', className)}>
      <span className="font-numeric">{fechaStr}</span>
      <span className="text-xs text-muted-foreground font-numeric">
        {horaStr}
      </span>
    </div>
  )
}