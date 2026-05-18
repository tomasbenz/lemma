import 'server-only'
import { Agent } from 'undici'

/**
 * Agente HTTPS específico para llamadas a AFIP.
 *
 * AFIP en producción a veces usa cipher suites/DH keys que Node 20+ rechaza
 * por defecto (issue conocido en libs argentinas). Este agente baja el
 * SECLEVEL solo para llamadas a AFIP, sin afectar el resto del HTTPS de la
 * app (Supabase, MercadoPago, etc.).
 *
 * Uso:
 *   import { getAfipAgent } from '@/lib/afip/http-agent'
 *   await fetch(url, { dispatcher: getAfipAgent() })
 *
 * Es singleton: una sola instancia para toda la app, reutiliza conexiones TCP.
 */

let agentSingleton: Agent | undefined

export function getAfipAgent(): Agent {
  if (agentSingleton) return agentSingleton

  agentSingleton = new Agent({
    connect: {
      // Reduce TLS security level solo para AFIP.
      // Equivalente a 'DEFAULT@SECLEVEL=1' pero scoped al agente.
      ciphers: 'DEFAULT@SECLEVEL=1',
      // Rechazar certs inválidos. AFIP tiene cert válido, no aceptamos
      // self-signed por error de configuración.
      rejectUnauthorized: true,
      // Timeout de 10s para establecer conexión TCP. Si AFIP está totalmente
      // caído, no queremos esperar 60-120s del default del kernel.
      timeout: 10_000,
    },
    // Timeouts una vez establecida la conexión:
    // - bodyTimeout: cuánto esperar entre paquetes del body
    // - headersTimeout: cuánto esperar a que lleguen los headers iniciales
    bodyTimeout: 30_000,
    headersTimeout: 30_000,
  })

  return agentSingleton
}
