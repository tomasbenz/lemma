// src/app/(app)/admin/_components/saludo-dashboard.tsx
'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Sun, Moon, Sunset } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Props = {
  nombre: string
}

type FranjaHoraria = 'mañana' | 'tarde' | 'noche'

function calcularFranja(hora: number): FranjaHoraria {
  if (hora >= 6 && hora < 13) return 'mañana'
  if (hora >= 13 && hora < 20) return 'tarde'
  return 'noche'
}

const SALUDOS: Record<
  FranjaHoraria,
  {
    saludo: string
    icon: React.ReactNode
    color: string
    fondoIcon: string
  }
> = {
  mañana: {
    saludo: 'Buenos días',
    icon: <Sun className="size-4" />,
    color: 'text-warning',
    fondoIcon: 'bg-warning/10 border-warning/30',
  },
  tarde: {
    saludo: 'Buenas tardes',
    icon: <Sunset className="size-4" />,
    color: 'text-info',
    fondoIcon: 'bg-info/10 border-info/30',
  },
  noche: {
    saludo: 'Buenas noches',
    icon: <Moon className="size-4" />,
    color: 'text-muted-foreground',
    fondoIcon: 'bg-muted border-border',
  },
}

function formatearFechaLarga(d: Date): string {
  const fecha = d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  // Capitalizamos el día (ej: "sábado" -> "Sábado")
  return fecha.charAt(0).toUpperCase() + fecha.slice(1)
}

function formatearHora(d: Date): string {
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Header del dashboard con saludo dinámico según la hora del cliente.
 *
 * Renderizado client-only para evitar hydration mismatch (la hora del server
 * puede no coincidir con la del usuario, especialmente entre franjas).
 */
export function SaludoDashboard({ nombre }: Props) {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(() => new Date())

  // Marcar como mounted + actualizar la hora cada minuto
  useEffect(() => {
    setMounted(true)
    setNow(new Date())

    const interval = setInterval(() => {
      setNow(new Date())
    }, 60 * 1000) // cada minuto

    return () => clearInterval(interval)
  }, [])

  // Primer nombre (si tiene apellido, lo cortamos)
  const primerNombre = nombre.trim().split(/\s+/)[0]

  // Fallback estable para SSR: solo el nombre, sin saludo dinámico
  if (!mounted) {
    return (
      <Card className="surface-1 enter-up">
        <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1
              className="text-2xl md:text-3xl font-bold tracking-tight"
              suppressHydrationWarning
            >
              Hola, {primerNombre}
            </h1>
          </div>
        </div>
      </Card>
    )
  }

  const franja = calcularFranja(now.getHours())
  const data = SALUDOS[franja]

  return (
    <Card className="surface-1 enter-up overflow-hidden relative">
      {/* Sutil gradient decorativo en la esquina superior derecha */}
      <div
        className={cn(
          'absolute -top-12 -right-12 size-40 rounded-full blur-3xl opacity-20 pointer-events-none',
          franja === 'mañana' && 'bg-warning',
          franja === 'tarde' && 'bg-info',
          franja === 'noche' && 'bg-primary'
        )}
        aria-hidden
      />

      <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative">
        <div className="flex-1 min-w-0">
          {/* Saludo + ícono */}
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className={cn(
                'inline-flex items-center justify-center size-7 rounded-full border',
                data.fondoIcon,
                data.color
              )}
              aria-hidden
            >
              {data.icon}
            </div>
            <p className={cn('text-sm font-medium', data.color)}>
              {data.saludo}
            </p>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Hola, {primerNombre}
            <span className="text-muted-foreground font-normal"> 👋</span>
          </h1>

          <p className="text-sm text-muted-foreground mt-1.5 font-numeric">
            {formatearFechaLarga(now)}
          </p>
        </div>

        {/* Hora a la derecha */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Hora actual
            </p>
            <p className="text-2xl font-bold font-numeric tabular-nums tracking-tight">
              {formatearHora(now)}
            </p>
          </div>
          <Sparkles
            className={cn('size-5 hidden md:block', data.color, 'opacity-60')}
            aria-hidden
          />
        </div>
      </div>
    </Card>
  )
}