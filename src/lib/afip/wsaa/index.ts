import 'server-only'
import { generarTra, type ServicioAfip } from './tra-builder'
import { firmarTra } from './cms-signer'
import { llamarLoginCms } from './soap-client'
import { leerTaDeCache, guardarTaEnCache } from './token-cache'
import { getAfipConfig } from '@/lib/afip/config'

/**
 * API pública del módulo WSAA.
 *
 * Este es el ÚNICO archivo del módulo wsaa que el resto del código debería
 * importar. Los archivos internos (tra-builder, cms-signer, etc.) son
 * detalles de implementación.
 */

export type ParametrosGetTokenSign = {
  empresaId: string
  service: ServicioAfip
}

export type TokenSign = {
  token: string
  sign: string
}

/**
 * Devuelve un Token+Sign válido para autenticarse contra el web service
 * de AFIP indicado.
 *
 * Flujo:
 * 1. Buscar en cache. Si está vigente, devolverlo.
 * 2. Si no, generar TRA → firmar con cert+key → llamar LoginCms.
 * 3. Guardar el TA nuevo en cache.
 * 4. Devolver Token+Sign.
 *
 * @throws Error si la config de AFIP falta, el cert es inválido, o WSAA rechaza.
 */
export async function getTokenSign(params: ParametrosGetTokenSign): Promise<TokenSign> {
  const { empresaId, service } = params

  // 1. Buscar en cache
  const cacheado = await leerTaDeCache({ empresaId, service })
  if (cacheado) {
    return { token: cacheado.token, sign: cacheado.sign }
  }

  // 2. Cache miss: generar TA nuevo
  const config = getAfipConfig()

  // 2.a Generar TRA
  const tra = generarTra(service)

  // 2.b Firmar con cert+key del config
  const cmsBase64 = firmarTra({
    traXml: tra.xml,
    certPem: config.certPem,
    keyPem: config.keyPem,
  })

  // 2.c Llamar LoginCms
  //
  // NOTA — NO wrappear con conReintentos:
  // AFIP rate-limitea agresivamente la generación de TAs (típicamente
  // 1 cada 10 minutos por servicio + CUIT). Si LoginCms falla, reintentar
  // en segundos genera un segundo error de "TA todavía válido" que oscurece
  // el problema original y puede llegar a banear temporalmente al cliente.
  // Mejor propagar el error tal cual y que el caller (server action,
  // smoke test, etc.) decida qué hacer.
  const respuesta = await llamarLoginCms({ cmsBase64, empresaId })

  // 3. Guardar en cache — best-effort fail-open.
  //    Si Supabase está caído o RLS rechaza, NO descartamos el TA recién
  //    generado: pagamos el costo de LoginCms (rate-limited, 1 cada 10
  //    min por servicio+CUIT) y queremos aprovechar el TA aunque no se
  //    persista. Próxima llamada va a hacer cache miss y regenerar igual,
  //    pero al menos esta llamada no rompe.
  try {
    await guardarTaEnCache({
      empresaId,
      service,
      token: respuesta.token,
      sign: respuesta.sign,
      expiresAt: respuesta.expirationTime,
    })
  } catch (err) {
    console.error(
      '[AFIP/WSAA] No se pudo cachear TA en Supabase, devolviendo de todos modos:',
      err instanceof Error ? err.message : err,
    )
  }

  // 4. Devolver
  return {
    token: respuesta.token,
    sign: respuesta.sign,
  }
}
