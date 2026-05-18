import 'server-only'

/**
 * Configuración de AFIP para Lemma.
 *
 * Lee variables de entorno y las valida. Lazy + cached: la primera vez
 * que se pide la config, se valida y memoriza. Las llamadas siguientes
 * devuelven la versión cacheada.
 *
 * Si falta config requerida, getAfipConfig() lanza Error con mensaje claro.
 * Para detectar si AFIP real está habilitado SIN instanciar config completa,
 * usar isAfipRealEnabled().
 */

export type AfipMode = 'homologation' | 'production'

export type AfipUrls = {
  wsaa: string
  wsfe: string
}

export type AfipConfig = {
  mode: AfipMode
  cuit: string                  // 11 dígitos sin guiones
  puntoVentaDefault: number
  certPem: string                // PEM completo, ya decodificado de base64
  keyPem: string                 // PEM completo, ya decodificado de base64
  urls: AfipUrls
}

const URLS_POR_MODO: Record<AfipMode, AfipUrls> = {
  homologation: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  production: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
}

let configCacheada: AfipConfig | undefined

/**
 * True si AFIP_MODE está seteado a 'homologation' o 'production'.
 * False si está vacío, undefined, o cualquier otro valor.
 *
 * Útil para que index.ts decida mock vs real sin instanciar config completa.
 * No lanza error nunca.
 */
export function isAfipRealEnabled(): boolean {
  const mode = process.env.AFIP_MODE
  return mode === 'homologation' || mode === 'production'
}

/**
 * Devuelve config validada. Lazy + cached.
 * Lanza Error si falta alguna variable requerida o tiene formato inválido.
 */
export function getAfipConfig(): AfipConfig {
  if (configCacheada) return configCacheada

  const mode = process.env.AFIP_MODE
  if (mode !== 'homologation' && mode !== 'production') {
    throw new Error(
      `AFIP_MODE inválido o faltante: "${mode}". ` +
      `Debe ser "homologation" o "production".`
    )
  }

  const cuit = process.env.AFIP_CUIT
  if (!cuit || !/^\d{11}$/.test(cuit)) {
    throw new Error(
      `AFIP_CUIT inválido o faltante: "${cuit}". ` +
      `Debe ser 11 dígitos sin guiones.`
    )
  }

  const puntoVentaRaw = process.env.AFIP_PUNTO_VENTA_DEFAULT
  const puntoVentaDefault = puntoVentaRaw ? parseInt(puntoVentaRaw, 10) : NaN
  if (Number.isNaN(puntoVentaDefault) || puntoVentaDefault < 1 || puntoVentaDefault > 9999) {
    throw new Error(
      `AFIP_PUNTO_VENTA_DEFAULT inválido o faltante: "${puntoVentaRaw}". ` +
      `Debe ser un número entre 1 y 9999.`
    )
  }

  const certB64 = process.env.AFIP_CERT_B64
  if (!certB64) {
    throw new Error('AFIP_CERT_B64 faltante')
  }
  const certPem = decodificarBase64(certB64, 'AFIP_CERT_B64')
  if (!certPem.includes('BEGIN CERTIFICATE')) {
    throw new Error('AFIP_CERT_B64 no contiene un certificado PEM válido')
  }

  const keyB64 = process.env.AFIP_KEY_B64
  if (!keyB64) {
    throw new Error('AFIP_KEY_B64 faltante')
  }
  const keyPem = decodificarBase64(keyB64, 'AFIP_KEY_B64')
  if (!keyPem.includes('BEGIN') || !keyPem.includes('PRIVATE KEY')) {
    throw new Error('AFIP_KEY_B64 no contiene una clave privada PEM válida')
  }

  configCacheada = {
    mode,
    cuit,
    puntoVentaDefault,
    certPem,
    keyPem,
    urls: URLS_POR_MODO[mode],
  }

  return configCacheada
}

function decodificarBase64(b64: string, nombre: string): string {
  try {
    return Buffer.from(b64, 'base64').toString('utf-8')
  } catch (err) {
    throw new Error(
      `${nombre} no se pudo decodificar de base64: ${err instanceof Error ? err.message : 'error desconocido'}`
    )
  }
}
