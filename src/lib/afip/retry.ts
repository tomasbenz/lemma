import 'server-only'
import { AfipWsfeError } from './wsfe/types'

/**
 * Capa genérica de reintentos para llamadas a AFIP.
 *
 * Política (decisión de producto, no replantear):
 * - 3 intentos, exponencial 1s → 2s → 4s con jitter ±20%.
 * - Total worst-case ~7s antes de propagar el error.
 * - Solo errores marcados como `reintentable` se reintentan; el resto
 *   se propaga inmediatamente (no perdemos tiempo en errores definitivos
 *   de validación o config).
 *
 * Esta función NO sabe nada de AFIP — es genérica. La política de qué
 * cuenta como reintentable se inyecta vía `esReintentable` (ver helper
 * `esErrorReintentableAfip` más abajo).
 */

export type OpcionesRetry = {
  /** Cantidad máxima de intentos (incluyendo el primero). Default deseado: 3. */
  maxIntentos: number
  /** Delay base en ms para el backoff exponencial. Default deseado: 1000. */
  baseMs: number
  /** Predicado: ¿este error amerita reintento? */
  esReintentable: (err: unknown) => boolean
  /** Hook opcional para logging entre intentos (no afecta flujo). */
  onIntentoFallido?: (intento: number, err: unknown, delayMs: number) => void
}

/**
 * Jitter ±20% sobre el delay calculado.
 * delay = baseMs * 2^(intento-1) * (0.8 + Math.random() * 0.4)
 */
const JITTER_MIN = 0.8
const JITTER_RANGE = 0.4

/**
 * Ejecuta `fn(intento)` con retry/backoff configurable.
 *
 * `fn` recibe el número de intento (1-indexed). Útil para que el caller
 * propague el `intento` al log de auditoría (afip_request_log.intento).
 *
 * Si `fn` resuelve, retorna el valor. Si rechaza:
 * - Si `esReintentable(err)` es true y aún quedan intentos, espera `delay`
 *   con jitter y vuelve a llamar `fn(intento + 1)`.
 * - Si no es reintentable, propaga inmediatamente.
 * - Si se agotan intentos, propaga el último error.
 */
export async function conReintentos<T>(
  fn: (intento: number) => Promise<T>,
  opciones: OpcionesRetry,
): Promise<T> {
  const { maxIntentos, baseMs, esReintentable, onIntentoFallido } = opciones

  let ultimoError: unknown
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await fn(intento)
    } catch (err) {
      ultimoError = err
      const esUltimo = intento === maxIntentos
      if (esUltimo || !esReintentable(err)) {
        throw err
      }
      const expBase = baseMs * Math.pow(2, intento - 1)
      const factor = JITTER_MIN + Math.random() * JITTER_RANGE
      const delayMs = Math.round(expBase * factor)
      onIntentoFallido?.(intento, err, delayMs)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  // Inalcanzable: el for siempre termina con return o throw, pero TS
  // no puede inferirlo desde el control flow.
  throw ultimoError
}

/**
 * Códigos de errores de red que vale la pena reintentar.
 * Vienen de undici (cliente HTTP de Node) y del kernel (Linux/macOS/Win).
 */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  // Servidor cierra el TCP mid-request — observable en AFIP homo bajo carga.
  'UND_ERR_CONNECTION_CLOSED',
  // Socket destruido en reuse del agent — pasa cuando el server cierra
  // keep-alive entre requests.
  'UND_ERR_DESTROYED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
])

/**
 * Predicado: ¿este error de AFIP amerita reintento?
 *
 * Reglas:
 * - AfipWsfeError con `severidadMaxima === 'reintentable'` → true
 * - Network error con `code` o `cause.code` matcheando el set → true
 * - Cualquier otro error (incluyendo errores de config, parsing, AFIP
 *   permanente o requiere_admin) → false
 */
export function esErrorReintentableAfip(err: unknown): boolean {
  if (err instanceof AfipWsfeError) {
    return err.severidadMaxima === 'reintentable'
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; cause?: unknown }
    if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) {
      return true
    }
    if (typeof e.cause === 'object' && e.cause !== null) {
      const c = e.cause as { code?: unknown }
      if (typeof c.code === 'string' && NETWORK_ERROR_CODES.has(c.code)) {
        return true
      }
    }
  }
  return false
}
