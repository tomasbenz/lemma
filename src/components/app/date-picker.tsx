'use client'

import { useState } from 'react'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type Props = {
  name: string
  defaultValue?: string | null // ISO YYYY-MM-DD
  placeholder?: string
  minYear?: number
  maxYear?: number
}

/**
 * DatePicker con estética del sistema. Escribe un hidden input con el nombre
 * provisto para ser leído por FormData en el submit.
 */
export function DatePicker({
  name,
  defaultValue = null,
  placeholder = 'Elegir fecha',
  minYear = 1950,
  maxYear = new Date().getFullYear() + 5,
}: Props) {
  const [fecha, setFecha] = useState<Date | undefined>(() => {
    if (!defaultValue) return undefined
    // Tratar como fecha local (no UTC) para evitar desfases de zona horaria
    const [y, m, d] = defaultValue.split('-').map((n) => parseInt(n, 10))
    if (!y || !m || !d) return undefined
    return new Date(y, m - 1, d)
  })
  const [open, setOpen] = useState(false)

  const iso = fecha ? toISODate(fecha) : ''

  return (
    <div className="flex items-center gap-1.5">
      <input type="hidden" name={name} value={iso} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              'justify-start text-left font-normal flex-1',
              !fecha && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="size-4 mr-2 shrink-0" />
            {fecha ? formatoLegible(fecha) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={fecha}
            onSelect={(d) => {
              setFecha(d)
              setOpen(false)
            }}
            defaultMonth={fecha ?? new Date()}
            captionLayout="dropdown"
            startMonth={new Date(minYear, 0)}
            endMonth={new Date(maxYear, 11)}
            locale={locale}
          />
        </PopoverContent>
      </Popover>
      {fecha && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setFecha(undefined)}
          className="shrink-0 h-9 w-9"
          title="Limpiar"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatoLegible(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

// Locale simple para react-day-picker
const locale = {
  code: 'es-AR',
  localize: {
    month: (n: number) =>
      [
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre',
      ][n],
    day: (n: number) =>
      ['D', 'L', 'M', 'M', 'J', 'V', 'S'][n],
    dayPeriod: (p: string) => p,
    era: (n: number) => (n === 0 ? 'AC' : 'DC'),
    ordinalNumber: (n: number) => String(n),
    quarter: (n: number) => `Q${n}`,
  },
  formatLong: {
    date: () => 'dd/MM/yyyy',
    time: () => 'HH:mm',
    dateTime: () => 'dd/MM/yyyy HH:mm',
  },
  options: { weekStartsOn: 1 as const },
}