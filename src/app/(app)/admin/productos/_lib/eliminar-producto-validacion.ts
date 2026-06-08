// Validación pura del input de eliminarProducto. Vive en _lib (fuera del server
// action, que es 'use server' y solo puede exportar funciones async) para poder
// testearla sin arrastrar next/cache ni el cliente de supabase. Se ubica acá y
// no en [id]/_actions porque el directorio con corchetes rompe el glob de
// node:test (interpreta [id] como character class).

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EliminarProductoInputValidado =
  | { ok: true; productoId: string; razon: string }
  | { ok: false; error: string }

/**
 * Valida el productoId (UUID) y la razón (obligatoria, ≤200 chars, trimeada).
 * Devuelve la razón ya trimeada lista para mandar a la RPC.
 */
export function validarEliminarProductoInput(input: {
  productoId: string
  razon: string
}): EliminarProductoInputValidado {
  if (typeof input.productoId !== 'string' || !UUID_RE.test(input.productoId)) {
    return { ok: false, error: 'ID inválido' }
  }
  const razon = typeof input.razon === 'string' ? input.razon.trim() : ''
  if (razon.length === 0) return { ok: false, error: 'La razón es obligatoria' }
  if (razon.length > 200) {
    return { ok: false, error: 'La razón es demasiado larga (máx 200 caracteres)' }
  }
  return { ok: true, productoId: input.productoId, razon }
}
