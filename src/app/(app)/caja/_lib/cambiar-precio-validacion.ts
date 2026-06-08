// Validación pura del input de cambiarPrecioCaja. Vive en _lib (fuera del
// server action, que es 'use server' y solo puede exportar funciones async)
// para poder testearla sin arrastrar next/cache ni el cliente de supabase.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CambiarPrecioInputValidado =
  | { ok: true; productoId: string; precioNuevo: number; razon: string | null }
  | { ok: false; error: string }

/**
 * Valida productoId (UUID), precioNuevo (número finito > 0) y razon (opcional,
 * ≤200 chars). Devuelve la razón trimeada (null si quedó vacía).
 *
 * Nota: `precioNuevo <= 0` NO descarta NaN/Infinity por sí solo (toda comparación
 * con NaN es false), por eso el guard explícito con Number.isFinite.
 */
export function validarCambiarPrecioInput(input: {
  productoId: unknown
  precioNuevo: unknown
  razon: unknown
}): CambiarPrecioInputValidado {
  if (typeof input.productoId !== 'string' || !UUID_RE.test(input.productoId)) {
    return { ok: false, error: 'ID de producto inválido' }
  }
  if (
    typeof input.precioNuevo !== 'number' ||
    !Number.isFinite(input.precioNuevo) ||
    input.precioNuevo <= 0
  ) {
    return { ok: false, error: 'El precio debe ser un número mayor a 0' }
  }
  const razonStr = typeof input.razon === 'string' ? input.razon.trim() : ''
  if (razonStr.length > 200) {
    return { ok: false, error: 'La razón es demasiado larga (máx 200 caracteres)' }
  }
  return {
    ok: true,
    productoId: input.productoId,
    precioNuevo: input.precioNuevo,
    razon: razonStr.length === 0 ? null : razonStr,
  }
}
