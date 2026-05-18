import 'server-only'
import { fetch } from 'undici'
import { getAfipAgent } from '@/lib/afip/http-agent'
import { getAfipConfig } from '@/lib/afip/config'
import {
  maskearAuthEnEnvelope,
  maskearCmsEnEnvelope,
  registrarLlamadaAfip,
  truncarXml,
  type ResultadoLlamadaAfip,
} from '@/lib/afip/request-log'

/**
 * Cliente SOAP minimal para llamar al endpoint LoginCms de WSAA.
 *
 * No usamos una librería SOAP genérica porque sería overkill: WSAA solo
 * tiene un método (loginCms) y el envelope es trivial. Construimos el
 * XML a mano.
 *
 * Forma del envelope (según WSDL oficial de homologación/producción):
 * - targetNamespace: 'http://wsaa.view.sua.dvadac.desein.afip.gov' (sin .ar).
 *   El namespace es el package Java original; NO coincide con el host de los
 *   endpoints (.afip.gov.ar). Apache Axis (server de AFIP) es lenient y acepta
 *   variantes con .ar, pero la forma WSDL-compliant es la sin .ar.
 * - elementFormDefault="qualified" → todos los elementos del namespace WSAA
 *   (loginCms, in0) deben ir con prefijo (wsaa:).
 *
 * Auditoría: cada llamada se registra en afip_request_log con el CMS
 * enmascarado (request) y los token/sign enmascarados (response).
 */

export type RespuestaLoginCms = {
  token: string
  sign: string
  expirationTime: Date
}

export type ParametrosLlamarLoginCms = {
  cmsBase64: string
  /** Empresa por la cual se está autenticando — necesaria para el log de auditoría. */
  empresaId: string
}

/**
 * Llama a LoginCms de WSAA con el CMS firmado.
 *
 * NO se aplica retry sobre esta llamada (ver comentario en wsaa/index.ts).
 * Por eso el `intento` queda fijo en 1 en el log de auditoría.
 *
 * @throws Error con info del SOAP Fault si AFIP rechaza
 */
export async function llamarLoginCms(
  params: ParametrosLlamarLoginCms,
): Promise<RespuestaLoginCms> {
  const { cmsBase64, empresaId } = params
  const config = getAfipConfig()
  const url = config.urls.wsaa

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soap:Header/>
  <soap:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soap:Body>
</soap:Envelope>`

  console.log('[AFIP/WSAA] Llamando LoginCms en', url)

  const inicio = performance.now()
  let httpStatus: number | null = null
  let responseText: string | null = null
  let resultado: ResultadoLlamadaAfip = 'error_red'
  let errorClase: string | undefined
  let errorMensaje: string | undefined

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '""',
      },
      body: envelope,
      dispatcher: getAfipAgent(),
    })

    httpStatus = response.status
    responseText = await response.text()

    if (!response.ok) {
      resultado = 'error_negocio'
      const fault = extraerSoapFault(responseText)
      // Defense in depth: el snippet del body termina en error_mensaje
      // del afip_request_log. Si AFIP en algún path raro echara token/sign
      // o un eco del CMS request, masking lo previene. fault ya es un
      // string corto (faultcode + faultstring), seguro masquearlo igual.
      const detalleCrudo = fault ?? responseText.substring(0, 500)
      const detalle = maskearAuthEnEnvelope(maskearCmsEnEnvelope(detalleCrudo))
      console.error('[AFIP/WSAA] HTTP error', response.status)
      throw new Error(`WSAA HTTP ${response.status}: ${detalle}`)
    }

    // Detectar SOAP Fault dentro del body (puede venir 200 OK con fault adentro)
    const fault = extraerSoapFault(responseText)
    if (fault) {
      resultado = 'error_negocio'
      console.error('[AFIP/WSAA] SOAP Fault:', fault)
      throw new Error(`WSAA rechazó el TRA: ${fault}`)
    }

    // Extraer el contenido de loginCmsReturn (viene escapado HTML)
    const loginCmsReturnEscapado = extraerEntreEtiquetas(responseText, 'loginCmsReturn')
    if (!loginCmsReturnEscapado) {
      resultado = 'error_negocio'
      throw new Error('Respuesta WSAA no contiene loginCmsReturn')
    }

    // Desescapar HTML entities básicas
    const loginTicketResponseXml = desescaparHtml(loginCmsReturnEscapado)

    // Extraer token, sign y expirationTime
    const token = extraerEntreEtiquetas(loginTicketResponseXml, 'token')
    const sign = extraerEntreEtiquetas(loginTicketResponseXml, 'sign')
    const expirationTimeStr = extraerEntreEtiquetas(loginTicketResponseXml, 'expirationTime')

    if (!token || !sign || !expirationTimeStr) {
      resultado = 'error_negocio'
      throw new Error('Respuesta WSAA incompleta: faltan token, sign o expirationTime')
    }

    const expirationTime = new Date(expirationTimeStr)
    if (Number.isNaN(expirationTime.getTime())) {
      resultado = 'error_negocio'
      throw new Error(`expirationTime de WSAA no es una fecha válida: ${expirationTimeStr}`)
    }

    console.log('[AFIP/WSAA] LoginCms OK, TA vence', expirationTime.toISOString())
    resultado = 'exito'
    return { token, sign, expirationTime }
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
    await registrarLlamadaAfip({
      empresaId,
      modo: config.mode,
      servicio: 'wsaa',
      metodo: 'LoginCms',
      endpoint: url,
      intento: 1,
      requestXml: maskearCmsEnEnvelope(envelope),
      responseXml:
        responseText !== null
          ? truncarXml(maskearAuthEnEnvelope(responseText))
          : null,
      httpStatus,
      duracionMs,
      resultado,
      errorClase,
      errorMensaje,
    })
  }
}

/**
 * Extrae el contenido entre etiquetas tipo <tag>...</tag>.
 * Devuelve null si no encuentra. Sin namespace prefix matching estricto.
 */
function extraerEntreEtiquetas(xml: string, tag: string): string | null {
  // Match <tag>...</tag> o <ns:tag>...</ns:tag>
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`
  )
  const match = xml.match(regex)
  return match ? match[1] : null
}

/**
 * Detecta y extrae un SOAP Fault si existe en la respuesta.
 */
function extraerSoapFault(xml: string): string | null {
  const faultString = extraerEntreEtiquetas(xml, 'faultstring')
  if (faultString) {
    const faultCode = extraerEntreEtiquetas(xml, 'faultcode') ?? 'unknown'
    return `${faultCode}: ${faultString}`
  }
  return null
}

/**
 * Desescapa entidades HTML básicas que vienen en loginCmsReturn.
 */
function desescaparHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

