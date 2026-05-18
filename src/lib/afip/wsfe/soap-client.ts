import 'server-only'
import { fetch } from 'undici'
import { getAfipAgent } from '@/lib/afip/http-agent'
import { getAfipConfig } from '@/lib/afip/config'
import {
  detectarResultadoEnXml,
  maskearAuthEnEnvelope,
  registrarLlamadaAfip,
  truncarXml,
  type ResultadoLlamadaAfip,
} from '@/lib/afip/request-log'

/**
 * Cliente SOAP minimal para WSFE.
 *
 * Es agnóstico del método: recibe el envelope ya construido por los builders
 * y la SOAPAction correspondiente, y devuelve el XML de respuesta crudo.
 * Los parsers se encargan de extraer los datos.
 *
 * Auditoría: cada llamada se registra en afip_request_log con Token/Sign
 * enmascarados. El `intento` viene del wrapper de retry (conReintentos)
 * cuando aplica; en caso contrario el caller pasa 1.
 */

const SOAP_ACTION_POR_METODO: Record<string, string> = {
  FEDummy: 'http://ar.gov.afip.dif.FEV1/FEDummy',
  FECompUltimoAutorizado: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
  FECAESolicitar: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
  FECompConsultar: 'http://ar.gov.afip.dif.FEV1/FECompConsultar',
}

export type ParametrosLlamarWsfe = {
  metodo: keyof typeof SOAP_ACTION_POR_METODO | string
  envelope: string
  /** Empresa por la cual se hace la llamada — necesaria para el log. */
  empresaId: string
  /** Número de intento (1-indexed). Lo pasa el wrapper conReintentos. */
  intento: number
  /**
   * Callback opcional invocado con el id de afip_request_log post-INSERT.
   * Si el INSERT falla (best-effort), se invoca igual con `null`. Permite
   * al caller (server action vía emitirFactura → adaptadorReal) capturar
   * el ID para persistirlo en `ventas.ultimo_request_log_id` sin queries
   * extra ni race conditions.
   */
  onLogged?: (logId: number | null) => void
}

/**
 * Llama a un método de WSFE y devuelve el XML de respuesta crudo.
 *
 * Sobre los códigos HTTP de AFIP:
 * - 2xx: respuesta exitosa, body válido para parsear
 * - 500: PUEDE traer un SOAP Fault legítimo en el body. NO lanzamos
 *   error solo por 500: dejamos que los parsers detecten el Fault
 *   (también pueden venir Errors collection con HTTP 200).
 * - 4xx: típicamente auth/not found/bad request sin body parseable.
 *   Lanzamos error directamente.
 *
 * Sobre el `resultado` registrado en afip_request_log:
 * - Si HTTP 2xx con body limpio → 'exito'
 * - Si HTTP 2xx con SOAP Fault o <Errors> → 'error_negocio'
 * - Si HTTP 5xx (con o sin Fault parseable) → 'error_negocio'
 * - Si HTTP 4xx → 'error_negocio' (y throw)
 * - Si fetch falla por red → 'error_red' (y throw el error original
 *   con cause.code intacto para que conReintentos pueda matchearlo)
 */
export async function llamarWsfe(params: ParametrosLlamarWsfe): Promise<string> {
  const { metodo, envelope, empresaId, intento, onLogged } = params

  const config = getAfipConfig()
  const url = config.urls.wsfe

  const soapAction = SOAP_ACTION_POR_METODO[metodo]
  if (!soapAction) {
    // No instrumentamos este caso porque ni siquiera salimos a red — es
    // un bug de programación, no una llamada AFIP fallida.
    throw new Error(`SOAPAction no definida para método "${metodo}"`)
  }

  console.log('[AFIP/WSFE] Llamando', metodo, 'en', url, '(intento', intento + ')')

  const inicio = performance.now()
  let httpStatus: number | null = null
  let responseText: string | null = null
  let resultado: ResultadoLlamadaAfip = 'error_red'
  let codigosError: number[] | undefined
  let errorClase: string | undefined
  let errorMensaje: string | undefined

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${soapAction}"`,
      },
      body: envelope,
      dispatcher: getAfipAgent(),
    })

    httpStatus = response.status
    responseText = await response.text()

    // HTTP 4xx: error sin body parseable
    if (response.status >= 400 && response.status < 500) {
      resultado = 'error_negocio'
      console.error('[AFIP/WSFE] HTTP error', response.status)
      // Defense in depth: el snippet termina en error_mensaje del log.
      // Maskear Token/Sign por si AFIP echa el envelope en el body 4xx.
      const detalle = maskearAuthEnEnvelope(responseText.substring(0, 500))
      throw new Error(
        `WSFE ${metodo} HTTP ${response.status}: ${detalle}`
      )
    }

    console.log('[AFIP/WSFE]', metodo, 'respondió', response.status)

    // Inspección de body para clasificar correctamente: HTTP 200 con
    // <Errors> debe loguearse como error_negocio, no como exito.
    const inspeccion = detectarResultadoEnXml(responseText)
    if (inspeccion.resultado === 'error_negocio') {
      resultado = 'error_negocio'
      codigosError = inspeccion.codigos.length > 0 ? inspeccion.codigos : undefined
    } else if (response.status >= 500) {
      // 5xx sin Fault detectable — igual lo marcamos como error_negocio
      // porque no es un éxito; pero NO throweamos: el parser del caller
      // decide si la respuesta es procesable.
      resultado = 'error_negocio'
    } else {
      resultado = 'exito'
    }

    return responseText
  } catch (err) {
    if (err instanceof Error) {
      errorClase = err.constructor.name
      errorMensaje = err.message
    } else {
      errorClase = 'unknown'
      errorMensaje = String(err)
    }
    throw err
  } finally {
    const duracionMs = Math.round(performance.now() - inicio)
    const logId = await registrarLlamadaAfip({
      empresaId,
      modo: config.mode,
      servicio: 'wsfe',
      metodo,
      endpoint: url,
      intento,
      requestXml: maskearAuthEnEnvelope(envelope),
      responseXml:
        responseText !== null
          ? truncarXml(maskearAuthEnEnvelope(responseText))
          : null,
      httpStatus,
      duracionMs,
      resultado,
      codigosError,
      errorClase,
      errorMensaje,
    })
    // Invocar callback aunque logId sea null — el caller necesita
    // saber que el INSERT falló para no esperar un ID que nunca llega.
    onLogged?.(logId)
  }
}
