import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

/**
 * Capa de auditoría: registra cada llamada HTTP a AFIP en
 * `public.afip_request_log`.
 *
 * Reglas:
 * - Best-effort: si el INSERT falla (Supabase caído, RLS rechaza, etc.),
 *   NO debe romper la operación AFIP en curso. Loguear el fallo a stderr
 *   y seguir.
 * - Cero credenciales en el row: el envelope WSAA va con CMS enmascarado,
 *   los envelopes WSFE van con Token/Sign enmascarados, y las respuestas
 *   se enmascaran también (token/sign aparecen escapados en LoginCms).
 * - response_xml truncado a 16 KiB para evitar bloat de la tabla.
 *
 * El service role bypassea RLS, así que el INSERT se hace con admin client.
 * Las policies son SELECT-only para usuarios; INSERT/UPDATE/DELETE bloqueados.
 */

export type ResultadoLlamadaAfip = 'exito' | 'error_negocio' | 'error_red' | 'error_config'
export type SeveridadLlamadaAfip = 'reintentable' | 'permanente' | 'requiere_admin'
export type ServicioLlamada = 'wsaa' | 'wsfe'
export type ModoLlamada = 'homologation' | 'production'

export type ParametrosRegistrarLlamada = {
  empresaId: string
  modo: ModoLlamada
  servicio: ServicioLlamada
  metodo: string
  endpoint: string
  intento: number
  requestXml: string | null
  responseXml: string | null
  httpStatus: number | null
  duracionMs: number
  resultado: ResultadoLlamadaAfip
  codigosError?: number[]
  severidadMax?: SeveridadLlamadaAfip
  errorClase?: string
  errorMensaje?: string
  contexto?: Record<string, unknown>
}

type AfipRequestLogInsert = Database['public']['Tables']['afip_request_log']['Insert']
type Json = Database['public']['Tables']['afip_request_log']['Insert']['contexto']

const MAX_BYTES_XML_DEFAULT = 16 * 1024 // 16 KiB

/**
 * Trunca XML a una cantidad máxima de bytes UTF-8.
 *
 * Importante: trunca por bytes (no por chars JS UTF-16) porque la columna
 * de Postgres mide tamaño en bytes. Si el corte cae en mitad de un char
 * multi-byte, Buffer.toString('utf8') reemplaza con replacement char (U+FFFD)
 * — aceptable para auditoría.
 */
export function truncarXml(xml: string, maxBytes: number = MAX_BYTES_XML_DEFAULT): string {
  const buf = Buffer.from(xml, 'utf8')
  if (buf.byteLength <= maxBytes) return xml
  const truncado = buf.subarray(0, maxBytes).toString('utf8')
  return `${truncado}\n<!-- TRUNCATED at ${maxBytes} bytes -->`
}

/**
 * Enmascara los valores de Token y Sign en un envelope SOAP.
 *
 * Cubre dos formas:
 * 1. Tags literales: `<ar:Token>...</ar:Token>` (request WSFE) y
 *    `<Token>...</Token>` sin prefijo.
 * 2. Tags HTML-escaped: `&lt;token&gt;...&lt;/token&gt;` (response WSAA,
 *    donde el loginCmsReturn viene con XML escapado adentro).
 *
 * Reemplaza el contenido por `[MASKED len=N]` preservando la longitud
 * original para auditoría sin exponer credenciales.
 */
const REGEX_TAG_AUTH = /(<(?:[a-zA-Z0-9]+:)?(Token|Sign)[^>]*>)([\s\S]*?)(<\/(?:[a-zA-Z0-9]+:)?\2>)/g
const REGEX_ESC_AUTH = /(&lt;(?:[a-zA-Z0-9]+:)?(token|sign)&gt;)([\s\S]*?)(&lt;\/(?:[a-zA-Z0-9]+:)?\2&gt;)/gi

export function maskearAuthEnEnvelope(xml: string): string {
  return xml
    .replace(REGEX_TAG_AUTH, (_match, abre, _tag, contenido, cierra) => {
      return `${abre}[MASKED len=${contenido.length}]${cierra}`
    })
    .replace(REGEX_ESC_AUTH, (_match, abre, _tag, contenido, cierra) => {
      return `${abre}[MASKED len=${contenido.length}]${cierra}`
    })
}

/**
 * Enmascara el contenido de `<wsaa:in0>` (CMS base64 firmado del LoginCms).
 * No queremos persistir el cert firmado en la DB.
 */
const REGEX_CMS = /(<(?:[a-zA-Z0-9]+:)?in0[^>]*>)([\s\S]*?)(<\/(?:[a-zA-Z0-9]+:)?in0>)/g

export function maskearCmsEnEnvelope(xml: string): string {
  return xml.replace(REGEX_CMS, (_match, abre, contenido, cierra) => {
    return `${abre}[CMS_BINARY len=${contenido.length}]${cierra}`
  })
}

/**
 * Inspecciona una respuesta XML de WSFE/WSAA y deduce un resultado
 * para el log antes de que el parser de alto nivel se ejecute.
 *
 * Esto permite registrar `error_negocio` cuando AFIP devuelve HTTP 200
 * con un SOAP Fault o un bloque <Errors> adentro — el HTTP status
 * solo no alcanza para clasificar.
 *
 * Si no detecta nada raro, retorna `'exito'` con codigos vacíos.
 */
export function detectarResultadoEnXml(
  xml: string,
): { resultado: ResultadoLlamadaAfip; codigos: number[] } {
  // Body vacío: nunca es éxito real. Caller (smoke test, parser) va a
  // throw "incompleta" después; clasificamos como error_negocio para
  // mantener consistencia con el log y poder filtrarlos en auditoría.
  if (xml.trim().length === 0) {
    return { resultado: 'error_negocio', codigos: [] }
  }
  if (/<(?:[a-zA-Z0-9]+:)?faultstring/i.test(xml)) {
    return { resultado: 'error_negocio', codigos: [] }
  }
  const errorsMatch = xml.match(
    /<(?:[a-zA-Z0-9]+:)?Errors[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Errors>/i,
  )
  if (errorsMatch) {
    const codigos: number[] = []
    const codeRegex = /<(?:[a-zA-Z0-9]+:)?Code[^>]*>(\d+)<\/(?:[a-zA-Z0-9]+:)?Code>/g
    let m: RegExpExecArray | null
    while ((m = codeRegex.exec(errorsMatch[1])) !== null) {
      codigos.push(parseInt(m[1], 10))
    }
    if (codigos.length > 0) {
      return { resultado: 'error_negocio', codigos }
    }
  }
  return { resultado: 'exito', codigos: [] }
}

/**
 * Registra una llamada AFIP en `afip_request_log`. Best-effort.
 *
 * Si el INSERT falla, loguea a stderr y traga el error para no afectar
 * el flujo AFIP del caller (la auditoría es importante pero no crítica).
 *
 * Retorna el `id` de la fila insertada (Fase 4.b.1.B), o `null` si el
 * insert falló. El caller que necesite trazabilidad (server action que
 * persiste en `ventas.ultimo_request_log_id`) lo usa; el resto puede
 * ignorar el return.
 */
export async function registrarLlamadaAfip(
  params: ParametrosRegistrarLlamada,
): Promise<number | null> {
  const insertRow: AfipRequestLogInsert = {
    empresa_id: params.empresaId,
    modo: params.modo,
    servicio: params.servicio,
    metodo: params.metodo,
    endpoint: params.endpoint,
    intento: params.intento,
    request_xml: params.requestXml,
    response_xml: params.responseXml,
    http_status: params.httpStatus,
    duracion_ms: params.duracionMs,
    resultado: params.resultado,
    codigos_error: params.codigosError ?? null,
    severidad_max: params.severidadMax ?? null,
    error_clase: params.errorClase ?? null,
    error_mensaje: params.errorMensaje ?? null,
    // El tipo Json del schema generado es recursivo y estricto; aceptamos
    // Record<string, unknown> en la API pública por ergonomía y casteamos
    // acá. Si el caller pasa valores no serializables, supabase-js falla
    // en runtime — mismo comportamiento que antes.
    contexto: (params.contexto ?? null) as Json,
  }

  try {
    const { data, error } = await createAdminClient()
      .from('afip_request_log')
      .insert(insertRow)
      .select('id')
      .single()
    if (error) {
      console.error('[AFIP/log] insert rechazado:', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error(
      '[AFIP/log] no se pudo registrar:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
