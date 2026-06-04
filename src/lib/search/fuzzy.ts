// Búsqueda de catálogo en el cliente (caja offline, editores de pedido/venta,
// selectores de cliente). Puro, sin dependencias.
//
// Estrategia: multi-word substring AND — lo que hacen Mercado Libre, WhatsApp
// y cualquier buscador de catálogo común. El query se normaliza (lower, sin
// tildes), se tokeniza por espacios, y un item matchea si TODOS los tokens
// aparecen como substring de su texto buscable (nombre+sku+marca+categoría).
// Sin scoring por similitud: en un POS, "LAPIZ" tiene que traer TODOS los
// lápices en orden predecible, no "los más relevantes según trigramas".
//
// Trade-off aceptado: typos no matchean ("lapizz" no encuentra "lapiz").
// Si se necesita tolerancia a typos, agregar una capa fuzzy ENCIMA de esto,
// no reemplazarlo.

/**
 * Normaliza un texto para búsqueda: lowercase + sin tildes/diacríticos.
 * NO elimina espacios — los preservamos para tokenizar.
 */
export function normalizar(texto: string): string {
  if (!texto) return ''
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remueve diacríticos combinantes
    .trim()
}

/**
 * Divide un query en tokens, normalizando primero y filtrando vacíos.
 * "  Lápiz   Negro  " → ["lapiz", "negro"]
 */
export function tokenizar(query: string): string[] {
  if (!query) return []
  return normalizar(query)
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Filtra items que contengan TODOS los tokens del query como substring del
 * texto extraído. Si el query es vacío, devuelve todos (sin reordenar; el
 * caller decide el orden inicial). Con `obtenerNombre`, ordena los matches
 * por nombre asc (estable y predecible); sin él, mantiene el orden original.
 */
export function buscar<T>(
  items: T[],
  query: string,
  obtenerTexto: (item: T) => string,
  obtenerNombre?: (item: T) => string
): T[] {
  const tokens = tokenizar(query)

  if (tokens.length === 0) return items

  // Match: el texto normalizado del item contiene cada token.
  const matches = items.filter((item) => {
    const texto = normalizar(obtenerTexto(item))
    return tokens.every((t) => texto.includes(t))
  })

  if (obtenerNombre) {
    matches.sort((a, b) =>
      normalizar(obtenerNombre(a)).localeCompare(normalizar(obtenerNombre(b)))
    )
  }

  return matches
}

/** @deprecated Use buscar() instead. Wrapper para retro-compatibilidad. */
export function rankear<T>(
  items: T[],
  query: string,
  obtenerTexto: (item: T) => string
): T[] {
  return buscar(items, query, obtenerTexto)
}

/** @deprecated Use buscar() instead. */
export function coincide(query: string, texto: string): boolean {
  const tokens = tokenizar(query)
  if (tokens.length === 0) return true
  const t = normalizar(texto)
  return tokens.every((token) => t.includes(token))
}
