// src/lib/utils/date-presets.ts

export type PresetFecha =
  | 'hoy'
  | 'ayer'
  | 'ultimos7'
  | 'ultimos30'
  | 'custom'
  | 'todas'

/**
 * Detecta qué preset usar a partir de un par desde/hasta.
 * Útil cuando los filtros vienen por URL y queremos rehidratar el botón activo.
 */
export function detectarPreset(
  desde?: string | null,
  hasta?: string | null
): PresetFecha {
  if (!desde && !hasta) return 'todas'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (desde) {
    const d = new Date(desde)
    d.setHours(0, 0, 0, 0)
    const diffDays = Math.floor(
      (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (diffDays === 0) return 'hoy'
    if (diffDays === 1 && hasta) {
      const h = new Date(hasta)
      if (h.getDate() === yesterday.getDate()) return 'ayer'
    }
    if (diffDays === 7) return 'ultimos7'
    if (diffDays === 30) return 'ultimos30'
  }

  return 'custom'
}

/**
 * Calcula el rango ISO (desde / hasta) para un preset dado.
 * Retorna strings vacíos si el preset no tiene rango fijo (todas / custom).
 */
export function calcularRango(preset: PresetFecha): {
  desde: string
  hasta: string
} {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const fmt = (d: Date, endOfDay = false) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const time = endOfDay ? '23:59:59' : '00:00:00'
    return `${y}-${m}-${day}T${time}`
  }

  switch (preset) {
    case 'hoy':
      return { desde: fmt(today), hasta: fmt(today, true) }
    case 'ayer': {
      const y = new Date(today)
      y.setDate(today.getDate() - 1)
      return { desde: fmt(y), hasta: fmt(y, true) }
    }
    case 'ultimos7': {
      const d = new Date(today)
      d.setDate(today.getDate() - 7)
      return { desde: fmt(d), hasta: fmt(today, true) }
    }
    case 'ultimos30': {
      const d = new Date(today)
      d.setDate(today.getDate() - 30)
      return { desde: fmt(d), hasta: fmt(today, true) }
    }
    case 'todas':
    case 'custom':
    default:
      return { desde: '', hasta: '' }
  }
}

/**
 * Lista canonical de presets para renderizar botones.
 */
export const PRESET_LIST: Array<{ key: PresetFecha; label: string }> = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'ayer', label: 'Ayer' },
  { key: 'ultimos7', label: '7 días' },
  { key: 'ultimos30', label: '30 días' },
  { key: 'todas', label: 'Todas' },
  { key: 'custom', label: 'Personalizado' },
]