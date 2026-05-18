/**
 * Formatea un número como precio en pesos argentinos.
 *
 * Ejemplos:
 * - 1500 → "$1.500"
 * - 1500.5 → "$1.500,50"
 * - 1234567.89 → "$1.234.567,89"
 */
export function formatARS(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) {
    return '$0'
  }

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: valor % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(valor)
}

/**
 * Formatea un número sin unidad (para cantidades, stock).
 *
 * Ejemplos:
 * - 1500 → "1.500"
 * - 15 → "15"
 */
export function formatNumber(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || isNaN(valor)) {
    return '0'
  }
  return new Intl.NumberFormat('es-AR').format(valor)
}

/**
 * Formatea una fecha de forma relativa si es reciente, absoluta si no.
 *
 * Ejemplos:
 * - hace 5 minutos → "hace 5 min"
 * - hace 2 días → "hace 2 d"
 * - hace 1 mes → "20 mar 2025"
 */
export function formatFechaRelativa(fecha: string | Date): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  const ahora = new Date()
  const diffMs = ahora.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffDias = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'hace instantes'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffH < 24) return `hace ${diffH} h`
  if (diffDias < 7) return `hace ${diffDias} d`

  return d.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}