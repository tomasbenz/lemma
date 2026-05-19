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
