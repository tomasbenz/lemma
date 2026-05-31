// src/lib/precios/redondeo.ts
//
// Redondeo de precios para aumentos masivos por categoría (Fase A).
//
// Espejo EXACTO de la función SQL public._redondear_precio (migración 021):
// el preview se calcula en TS con este helper y el apply lo hace la RPC con
// la versión SQL. Ambos DEBEN producir el mismo resultado para que lo que el
// usuario ve en el preview sea lo que termina en la DB.
//
// Nota: Math.round redondea "half up" hacia +Infinito; Postgres round() para
// numeric redondea "half away from zero". Para precios (siempre >= 0) ambos
// coinciden, por eso el espejo es válido.

export type EstrategiaRedondeo = 'none' | 'r10' | 'r50' | 'r100'

export function redondearPrecio(
  precio: number,
  estrategia: EstrategiaRedondeo
): number {
  if (!Number.isFinite(precio) || precio < 0) {
    throw new Error('redondearPrecio: precio inválido')
  }
  switch (estrategia) {
    case 'none':
      return Math.round(precio * 100) / 100
    case 'r10':
      return Math.round(precio / 10) * 10
    case 'r50':
      return Math.round(precio / 50) * 50
    case 'r100':
      return Math.round(precio / 100) * 100
  }
}

export const LABELS_REDONDEO: Record<EstrategiaRedondeo, string> = {
  none: 'Sin redondeo',
  r10: 'A $10',
  r50: 'A $50',
  r100: 'A $100',
}

export const DEFAULT_REDONDEO: EstrategiaRedondeo = 'r100'

/** Type guard para validar input del cliente. */
export function esEstrategiaRedondeo(v: unknown): v is EstrategiaRedondeo {
  return v === 'none' || v === 'r10' || v === 'r50' || v === 'r100'
}
