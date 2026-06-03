// src/lib/queries/_helpers.ts
//
// Helpers compartidos entre módulos de queries.

/**
 * Sanitiza un string para usarse como valor dentro de un filtro `.or()` o
 * `.filter()` de Supabase / PostgREST.
 *
 * `supabase.from(...).or('col.ilike.%foo%,otra.eq.bar')` toma una string
 * PostgREST: las comas separan condiciones y los paréntesis agrupan. Si
 * el usuario pone `,` o `()` en el input de búsqueda, la string se
 * reescribe y el filtro hace algo totalmente distinto (en el mejor caso
 * un 400, en el peor un match no deseado).
 *
 * Además quitamos `*` y `%` que son wildcards de `ilike`: si el usuario
 * escribe `*foo*`, Postgres lo interpreta como cualquier-cosa-foo-cualquier-cosa
 * dentro del `%${q}%` que ya envuelve la query — útil para el atacante,
 * inesperado para la usuaria normal.
 *
 * El resultado se concatena dentro de `%${q}%` por el caller, así que
 * SIEMPRE devuelve string trimeada y sin caracteres peligrosos.
 */
export function escaparParaOrFilter(valor: string): string {
  return valor
    .replace(/[,()]/g, ' ')
    .replace(/\*/g, '')
    .replace(/%/g, '')
    .trim()
}

/**
 * Tamaño de lote para `.in()` grandes. PostgREST arma GETs y el edge de
 * Supabase rechaza URLs de más de ~16KB (~390 UUIDs) con 400 Bad Request.
 * 200 UUIDs ≈ 8KB de URL: la mitad del límite, con margen para el resto
 * de la query string.
 */
const IN_LOTE_DEFAULT = 200

/** Parte un array en lotes de `tamano` elementos (el último puede ser menor). */
export function partirEnLotes<T>(items: T[], tamano = IN_LOTE_DEFAULT): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano))
  }
  return lotes
}

type ResultadoLote<T, E> = { data: T[] | null; error: E | null }

/**
 * Ejecuta una query `.in('col', ids)` en lotes paralelos para no superar el
 * límite de ~16KB de URL de PostgREST (ver IN_LOTE_DEFAULT). El caller arma
 * la query por chunk; acá se dispara todo con Promise.all y se concatena.
 *
 * - `ids` vacío → `{ data: [], error: null }` sin tocar la red.
 * - Si entra en un solo lote, se ejecuta directo (sin overhead).
 * - Si algún lote falla, devuelve el primer error y data vacía (mismo
 *   contrato error-first que una query simple de Supabase).
 *
 * El orden del resultado es el de los lotes (estable respecto de `ids`),
 * pero como casi todos los callers reordenan en JS (ranking fuzzy) o
 * agrupan en Maps, no dependas del orden para semántica fina.
 */
export async function inLotes<T, E extends { message: string }>(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<ResultadoLote<T, E>>,
  tamano = IN_LOTE_DEFAULT
): Promise<{ data: T[]; error: E | null }> {
  if (ids.length === 0) return { data: [], error: null }

  if (ids.length <= tamano) {
    const { data, error } = await query(ids)
    return { data: data ?? [], error }
  }

  const resultados = await Promise.all(
    partirEnLotes(ids, tamano).map((chunk) => query(chunk))
  )

  const conError = resultados.find((r) => r.error)
  if (conError?.error) return { data: [], error: conError.error }

  return { data: resultados.flatMap((r) => r.data ?? []), error: null }
}
