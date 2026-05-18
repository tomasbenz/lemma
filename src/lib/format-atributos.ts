// src/lib/format-atributos.ts
//
// Helper para formatear el jsonb `atributos` de una variante (y el snapshot
// `variante_atributos` de items_venta) en un string legible.
//
// Ejemplo: { color: 'Rojo', tamaño: 'A4' } → "Color: Rojo · Tamaño: A4"
//
// El modelo de variantes de Lemma generaliza el viejo par (color, talle) del
// proyecto Loom Point (textil) en un jsonb arbitrario para que la misma
// tabla `variantes` sirva a:
//   - librería: { color: 'azul', formato: 'A4', gramaje: '80g' }
//   - alimentos: { presentación: '250ml', sabor: 'frutilla' }
//   - textil (caso Loom Point): { color: 'rojo', talle: 'M' }
//
// La definición de qué atributos espera cada categoría vive en la tabla
// `categoria_atributos` y se renderiza dinámicamente en el wizard de
// creación de variantes.

export type Atributos = Record<string, string>

const KEY_LABELS: Record<string, string> = {
  color: 'Color',
  talle: 'Talle',
  tamaño: 'Tamaño',
  tamano: 'Tamaño',
  formato: 'Formato',
  gramaje: 'Gramaje',
  presentacion: 'Presentación',
  presentación: 'Presentación',
  sabor: 'Sabor',
  edicion: 'Edición',
  edición: 'Edición',
}

/**
 * Convierte una clave de atributo en su label visible. Hace dos cosas:
 *  - Mapea claves conocidas a su nombre castellano correcto (ej "tamano"
 *    → "Tamaño") para no depender de cómo la cargó la usuaria.
 *  - Para claves desconocidas, hace title-case.
 */
function labelClave(clave: string): string {
  const norm = clave.toLowerCase().trim()
  if (norm in KEY_LABELS) return KEY_LABELS[norm]
  return clave.charAt(0).toUpperCase() + clave.slice(1)
}

/**
 * Convierte un jsonb de atributos en string legible.
 *
 * @param atributos objeto plano con valores string. Si recibe null/undefined
 *                  o no es objeto, devuelve string vacío.
 * @param sep separador entre pares clave/valor. Default ' · '.
 * @returns string vacío si no hay atributos; "Color: Rojo · Tamaño: A4" si los hay.
 */
export function formatAtributos(
  atributos: unknown,
  sep: string = ' · ',
): string {
  if (!atributos || typeof atributos !== 'object' || Array.isArray(atributos)) {
    return ''
  }
  const entries = Object.entries(atributos as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== '',
  )
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${labelClave(k)}: ${String(v)}`).join(sep)
}

/**
 * Devuelve el label corto para usar como nombre de variante (ej en el
 * carrito o el selector). Si no hay atributos, devuelve 'Única'.
 */
export function nombreVariante(atributos: unknown): string {
  const formateado = formatAtributos(atributos)
  return formateado || 'Única'
}

/**
 * Sufijo determinístico para SKU de variante a partir de atributos.
 * Ej: { color: 'rojo', talle: 'M' } → "ROJO-M"
 *     {} → "DEFAULT"
 *
 * Ordena las claves alfabéticamente para que la misma combinación de
 * atributos siempre produzca el mismo sufijo, independiente del orden
 * con que la usuaria los haya cargado.
 */
export function sufijoSku(atributos: Atributos): string {
  const entries = Object.entries(atributos)
    .filter(([, v]) => v.trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return 'DEFAULT'
  return entries
    .map(([, v]) => v.toUpperCase().replace(/\s+/g, '-'))
    .join('-')
}
