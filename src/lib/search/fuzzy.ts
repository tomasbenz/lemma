// Búsqueda fuzzy en el cliente (caja offline, editores de pedido/venta).
// Puro, sin dependencias. Espeja la normalización del lado server
// (normalizar_busqueda en SQL): lower + sin tildes + sin espacios.
//
// Tolera typos, tildes, mayúsculas y espacios sobrantes. Los espacios se
// ELIMINAN (no se colapsan): así "abro ch a do ra" → "abrochadora" matchea
// "abrochadorakangaro...", y "Kangaro o o o o" → "kangarooooo". Sin esto,
// los trigramas con espacios no aparecen en la versión continua del producto
// y la similitud cae bajo el umbral.

const UMBRAL_DEFAULT = 0.3

/** lower + quita tildes + elimina todos los espacios. */
export function normalizar(s: string): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
}

/** Set de trigramas con padding, sobre el string ya normalizado. */
function trigramas(s: string): Set<string> {
  const set = new Set<string>()
  if (s.length === 0) return set
  const padded = `  ${s} `
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3))
  }
  return set
}

/** Coeficiente de Dice sobre trigramas. Rango 0–1 (1 = idénticos). */
export function similitudTrigram(a: string, b: string): number {
  const na = normalizar(a)
  const nb = normalizar(b)
  if (na === nb) return na.length === 0 ? 0 : 1
  const ta = trigramas(na)
  const tb = trigramas(nb)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return (2 * inter) / (ta.size + tb.size)
}

/**
 * True si `query` matchea `target`.
 * - query vacía → true (no filtra).
 * - query < 3 chars → substring (smart fallback, no degrada SKUs cortos).
 * - includes-first (fast path) → si no, similitud de trigramas >= umbral.
 */
export function coincide(
  query: string,
  target: string,
  umbral = UMBRAL_DEFAULT
): boolean {
  const nq = normalizar(query)
  if (nq.length === 0) return true
  const nt = normalizar(target)

  if (nq.length < 3) return nt.includes(nq)
  if (nt.includes(nq)) return true
  return similitudTrigram(nq, nt) >= umbral
}

/** Score de relevancia: 1 si substring, similitud si no, 0 si no matchea. */
function score(query: string, target: string, umbral: number): number {
  const nq = normalizar(query)
  if (nq.length === 0) return 1
  const nt = normalizar(target)
  if (nq.length < 3) return nt.includes(nq) ? 1 : 0
  if (nt.includes(nq)) return 1
  const sim = similitudTrigram(nq, nt)
  return sim >= umbral ? sim : 0
}

/**
 * Filtra + ordena por relevancia descendente. Con query vacía devuelve los
 * items tal cual (sin reordenar). Los que no matchean se excluyen.
 */
export function rankear<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  umbral = UMBRAL_DEFAULT
): T[] {
  if (normalizar(query).length === 0) return items

  return items
    .map((item) => ({ item, s: score(query, getText(item), umbral) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item)
}
