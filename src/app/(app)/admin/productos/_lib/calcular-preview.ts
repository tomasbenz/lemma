// Cálculos puros para la preview editable de acciones masivas (Fase 2).
//
// Separados de React y de la capa de datos para poder testearlos sin levantar
// nada. El "propuesto" debe coincidir con lo que harían las RPCs de Fase 1
// (precio_pct: round + clamp >= 0; stock: sumar/restar/fijar) para que el
// usuario vea exactamente el valor que se va a aplicar.

import type { ProductoPreview } from '@/lib/queries/productos'

// Espejo de round2 de @/lib/cobro/calculos. Definido local para no depender del
// alias '@/' en el runtime de los tests (node --test + tsx, imports relativos).
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type FilaPreview = {
  id: string
  nombre: string
  /** Precio actual o stock actual. */
  actual: number
  /** Valor calculado por la regla base. */
  propuesto: number
  omitido: boolean
  motivoOmision?: string
}

/**
 * Preview de "subir/bajar precio X%". propuesto = max(round2(actual*(1+pct/100)), 0).
 * No hay omitidos: el cambio de precio aplica a todo producto.
 */
export function calcularPreviewPrecioPct(
  productos: ProductoPreview[],
  pct: number
): FilaPreview[] {
  return productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    actual: p.precio_neto,
    propuesto: Math.max(round2(p.precio_neto * (1 + pct / 100)), 0),
    omitido: false,
  }))
}

export type ModoStock = 'sumar' | 'restar' | 'fijar'

/**
 * Preview de ajuste de stock. Solo aplica a productos con UNA variante activa;
 * el resto se marca omitido (igual criterio que la RPC). propuesto es el stock
 * ABSOLUTO final.
 */
export function calcularPreviewStock(
  productos: ProductoPreview[],
  modo: ModoStock,
  valor: number
): FilaPreview[] {
  return productos.map((p) => {
    const base = {
      id: p.id,
      nombre: p.nombre,
    }

    if (!p.track_stock) {
      return {
        ...base,
        actual: 0,
        propuesto: 0,
        omitido: true,
        motivoOmision: 'Producto sin control de stock',
      }
    }

    const activas = p.variantes.filter((v) => v.activa)

    if (activas.length === 0) {
      return {
        ...base,
        actual: 0,
        propuesto: 0,
        omitido: true,
        motivoOmision: 'Sin variantes activas',
      }
    }
    if (activas.length > 1) {
      const actual = activas.reduce((acc, v) => acc + v.stock, 0)
      return {
        ...base,
        actual,
        propuesto: actual,
        omitido: true,
        motivoOmision: 'Múltiples variantes — ajustá desde el detalle',
      }
    }

    const actual = activas[0].stock
    const propuesto =
      modo === 'sumar'
        ? actual + valor
        : modo === 'restar'
          ? actual - valor
          : valor

    if (propuesto < 0) {
      return {
        ...base,
        actual,
        propuesto,
        omitido: true,
        motivoOmision: 'Stock insuficiente (quedaría negativo)',
      }
    }

    return { ...base, actual, propuesto, omitido: false }
  })
}
