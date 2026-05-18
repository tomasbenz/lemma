/**
 * Helpers para clasificar errores de PostgreSQL (vía Supabase / PostgREST).
 *
 * Los códigos de error de Postgres están estandarizados (SQLSTATE):
 *   https://www.postgresql.org/docs/current/errcodes-appendix.html
 *
 * Supabase los propaga en el campo `code` del PostgrestError. Acá centralizamos
 * la detección para no esparcir literales '23505' por el código.
 */

/** SQLSTATE 23505: unique_violation. */
const SQLSTATE_UNIQUE_VIOLATION = '23505'

/**
 * Verifica si un error de Supabase corresponde a una violación de UNIQUE
 * constraint. Acepta cualquier shape de error razonable para no acoplarse
 * al tipo exacto de Supabase (que puede variar entre versiones del SDK).
 *
 * Devuelve `true` si encuentra un campo `code` igual a '23505' en el error
 * raíz o en `error.cause`. Cualquier otra cosa → `false`.
 */
export function detectarErrorUniqueConstraint(err: unknown): boolean {
  if (err === null || err === undefined) return false
  if (typeof err !== 'object') return false

  const e = err as { code?: unknown; cause?: unknown }
  if (typeof e.code === 'string' && e.code === SQLSTATE_UNIQUE_VIOLATION) {
    return true
  }
  if (e.cause && typeof e.cause === 'object') {
    const c = e.cause as { code?: unknown }
    if (typeof c.code === 'string' && c.code === SQLSTATE_UNIQUE_VIOLATION) {
      return true
    }
  }
  return false
}
