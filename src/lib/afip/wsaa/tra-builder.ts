import 'server-only'

/**
 * Builder del XML TRA (Ticket Request Access) para WSAA.
 *
 * El TRA es el primer paso para obtener un Token de Acceso de AFIP.
 * Se firma con el certificado del contribuyente y se envía al endpoint
 * LoginCms de WSAA, que devuelve el Token+Sign.
 *
 * Reglas críticas (según Especificación Técnica WSAA 1.2.x de AFIP):
 * - uniqueId: entero de 32 bits sin signo (max 4.294.967.295). Junto con
 *   generationTime identifica al requerimiento. Usamos unix timestamp en
 *   segundos: ~1.78×10⁹ en 2026, entra cómodo en int32.
 * - generationTime y expirationTime DEBEN tener timezone explícito.
 * - La diferencia entre generationTime y expirationTime no puede ser mayor
 *   a 24 horas. Usamos 10 minutos por simplicidad.
 *
 * AFIP usa (uniqueId, generationTime) como clave de idempotencia. Como
 * cacheamos el TA por horas en la tabla afip_ta_cache, en la práctica
 * nunca generamos dos TRAs en el mismo segundo, así que no necesitamos
 * contador adicional.
 */

export type ServicioAfip = 'wsfe' // En el futuro: 'wsfex' | 'wsmtxca' | etc.

export type TraGenerado = {
  uniqueId: number
  generationTime: string
  expirationTime: string
  service: ServicioAfip
  xml: string
}

/**
 * Margen de drift hacia atrás aplicado al generationTime.
 *
 * Gold standard según spec WSAA: sincronizar el reloj del cliente vía NTP
 * contra time.afip.gov.ar y mandar generationTime ≈ "ahora real". En runtimes
 * serverless (Vercel) NO podemos garantizar sync NTP del host, así que
 * compensamos con margen: si AFIP está hasta 5 min adelantado respecto de
 * nosotros, generationTime sigue cayendo en su pasado y acepta el TRA.
 *
 * Si AFIP está atrasado respecto de nosotros, lo compensa el +10 min de
 * expirationTime (ver abajo).
 */
const DRIFT_GENERATION_MS = 5 * 60 * 1000

/** Vigencia del TRA desde "ahora". Spec permite hasta 24h. */
const VIGENCIA_TRA_MS = 10 * 60 * 1000

/**
 * Genera el XML TRA listo para firmar.
 *
 * @param service - El servicio de AFIP al que se quiere acceder
 * @returns Objeto con el XML y los metadatos del TRA generado
 */
export function generarTra(service: ServicioAfip): TraGenerado {
  const ahora = new Date()

  // uniqueId: unix timestamp en segundos (int32 unsigned, ~10 dígitos).
  // NO multiplicar por 1000 — eso lo manda a trillones y AFIP rechaza el
  // schema con "xml.bad: No se ha podido interpretar el XML contra el SCHEMA".
  const uniqueId = Math.floor(ahora.getTime() / 1000)

  // generationTime: ahora menos drift, con offset Argentina (-03:00)
  const tiempoGeneracion = new Date(ahora.getTime() - DRIFT_GENERATION_MS)
  const generationTime = formatearIso8601ConOffset(tiempoGeneracion)

  // expirationTime: ahora + 10 minutos con mismo offset
  const expiracion = new Date(ahora.getTime() + VIGENCIA_TRA_MS)
  const expirationTime = formatearIso8601ConOffset(expiracion)

  const xml = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header><service>${service}</service></loginTicketRequest>`

  return {
    uniqueId,
    generationTime,
    expirationTime,
    service,
    xml,
  }
}

/**
 * Formatea una Date a ISO 8601 con offset -03:00 (Argentina).
 *
 * Ejemplo: 2026-05-04T03:30:45-03:00
 *
 * NO usar toISOString() porque devuelve UTC con 'Z' al final, y AFIP
 * espera el offset explícito.
 */
function formatearIso8601ConOffset(fecha: Date): string {
  // Argentina es UTC-3 sin daylight saving
  const offsetMinutos = -3 * 60
  const fechaLocal = new Date(fecha.getTime() + offsetMinutos * 60 * 1000)

  const year = fechaLocal.getUTCFullYear()
  const month = String(fechaLocal.getUTCMonth() + 1).padStart(2, '0')
  const day = String(fechaLocal.getUTCDate()).padStart(2, '0')
  const hour = String(fechaLocal.getUTCHours()).padStart(2, '0')
  const minute = String(fechaLocal.getUTCMinutes()).padStart(2, '0')
  const second = String(fechaLocal.getUTCSeconds()).padStart(2, '0')

  return `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`
}
