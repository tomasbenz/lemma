// src/components/app/fecha-relativa.tsx
'use client'

import { useEffect, useState } from 'react'

type Props = {
  /** Fecha en formato ISO o cualquier string parseable por Date */
  fecha: string
  /** Variante del texto: 'corta' (5 min, 2 h, ayer) | 'larga' (hace 5 min, hace 2 h) */
  variante?: 'corta' | 'larga'
  /** Si es true, muestra fecha completa formateada (ej: 25 de abril, 14:30) */
  larga?: boolean
  className?: string
}

function calcularRelativa(
  fecha: string,
  variante: 'corta' | 'larga'
): string {
  const d = new Date(fecha)
  const ahora = new Date()
  const diffMs = ahora.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffDias = Math.floor(diffH / 24)

  if (variante === 'corta') {
    if (diffMin < 1) return 'recién'
    if (diffMin < 60) return `${diffMin} min`
    if (diffH < 24) return `${diffH} h`
    if (diffDias === 1) return 'ayer'
    if (diffDias < 7) return `${diffDias} d`
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
  }

  // larga
  if (diffMin < 1) return 'hace un momento'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffH < 24) return `hace ${diffH} h`
  if (diffDias === 1) return 'ayer'
  if (diffDias < 7) return `hace ${diffDias} días`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

function calcularLargaCompleta(fecha: string): string {
  const d = new Date(fecha)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Renderiza una fecha relativa ("hace 5 min", "ayer", etc.) o una fecha
 * larga ("25 de abril, 14:30") solo en el cliente para evitar mismatches
 * de hidratación. En SSR muestra una versión estable (la fecha cruda).
 */
export function FechaRelativa({
  fecha,
  variante = 'corta',
  larga = false,
  className,
}: Props) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const tooltipFull = (() => {
    try {
      return new Date(fecha).toLocaleString('es-AR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return fecha
    }
  })()

  // En SSR y en el primer render del cliente, mostrar fecha estable
  if (!mounted) {
    const fallback = larga
      ? calcularLargaCompleta(fecha)
      : new Date(fecha).toLocaleDateString('es-AR', {
          day: '2-digit',
          month: 'short',
        })
    return (
      <span className={className} title={tooltipFull} suppressHydrationWarning>
        {fallback}
      </span>
    )
  }

  const texto = larga
    ? calcularLargaCompleta(fecha)
    : calcularRelativa(fecha, variante)

  return (
    <span className={className} title={tooltipFull}>
      {texto}
    </span>
  )
}