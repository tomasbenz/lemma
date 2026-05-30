// Helpers de presentación para operaciones masivas (listado + detalle).
// Puros, sin React ni datos.

export const ACCION_LABEL: Record<string, string> = {
  precio_pct: 'Precio (%)',
  precio_fijo: 'Precio fijo',
  cambiar_categoria: 'Categoría',
  cambiar_activo: 'Activar / Desactivar',
  stock_sumar: 'Sumar stock',
  stock_restar: 'Restar stock',
  stock_fijar: 'Fijar stock',
  precio_individual: 'Precio (individual)',
  stock_individual: 'Stock (individual)',
  import: 'Importación Excel',
}

export function formatearAccion(accion: string): string {
  return ACCION_LABEL[accion] ?? accion
}

/**
 * Render legible de los parámetros guardados por la RPC, según la acción.
 */
export function renderParametros(accion: string, parametros: unknown): string {
  const p =
    parametros && typeof parametros === 'object' && !Array.isArray(parametros)
      ? (parametros as Record<string, unknown>)
      : {}

  const conMotivo = (base: string): string =>
    p.motivo ? `${base} · motivo: ${String(p.motivo)}` : base

  switch (accion) {
    case 'precio_pct': {
      const pct = Number(p.pct ?? 0)
      return pct >= 0 ? `Subir ${pct}%` : `Bajar ${Math.abs(pct)}%`
    }
    case 'precio_fijo':
      return `Fijar precio a $${p.precio ?? '—'}`
    case 'cambiar_categoria':
      return p.categoria
        ? `Cambiar categoría a "${String(p.categoria)}"`
        : 'Quitar categoría (sin categoría)'
    case 'cambiar_activo':
      return p.activo ? 'Activar productos' : 'Desactivar productos'
    case 'stock_sumar':
      return conMotivo(`Sumar ${p.valor ?? '—'} al stock`)
    case 'stock_restar':
      return conMotivo(`Restar ${p.valor ?? '—'} al stock`)
    case 'stock_fijar':
      return conMotivo(`Fijar stock en ${p.valor ?? '—'}`)
    case 'precio_individual':
      return 'Ajuste individual de precios (fila por fila)'
    case 'stock_individual':
      return conMotivo('Ajuste individual de stock (fila por fila)')
    case 'import':
      return 'Importación / actualización desde Excel'
    default:
      return '—'
  }
}

/** Fecha corta es-AR para tablas. */
export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
