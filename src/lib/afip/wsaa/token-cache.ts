import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAfipConfig } from '@/lib/afip/config'
import type { ServicioAfip } from './tra-builder'

/**
 * Cache del Token de Acceso (TA) de WSAA en Supabase.
 *
 * El TA dura 12 horas. AFIP rate-limitea la generación de TAs nuevos,
 * así que es OBLIGATORIO cachear.
 *
 * Tabla: public.afip_ta_cache (tipos generados en src/types/database.ts)
 * PK: (empresa_id, service, modo)
 *
 * Multi-tenant: cada empresa tiene su propio TA.
 * Multi-modo: una empresa puede tener TA de homologation y production
 * cacheados al mismo tiempo (útil durante testing).
 */

export type TaEnCache = {
  token: string
  sign: string
  expiresAt: Date
}

const MARGEN_SEGURIDAD_MS = 5 * 60 * 1000  // 5 minutos antes de vencer, lo regeneramos

export type ParametrosLeerCache = {
  empresaId: string
  service: ServicioAfip
}

/**
 * Lee el TA cacheado para esta combinación. Devuelve null si:
 * - No hay nada cacheado
 * - Lo cacheado vence en menos de 5 minutos (margen de seguridad)
 */
export async function leerTaDeCache(params: ParametrosLeerCache): Promise<TaEnCache | null> {
  const { empresaId, service } = params
  const config = getAfipConfig()

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('afip_ta_cache')
    .select('token, sign, expires_at')
    .eq('empresa_id', empresaId)
    .eq('service', service)
    .eq('modo', config.mode)
    .maybeSingle()

  if (error) {
    console.error('[AFIP/WSAA cache] Error leyendo:', error.message)
    return null
  }

  if (!data) {
    return null
  }

  const expiresAt = new Date(data.expires_at)
  const ahora = Date.now()

  // Si vence en menos del margen de seguridad, lo consideramos vencido
  if (expiresAt.getTime() - ahora < MARGEN_SEGURIDAD_MS) {
    console.log('[AFIP/WSAA cache] TA vencido o por vencer, regenerando')
    return null
  }

  return {
    token: data.token,
    sign: data.sign,
    expiresAt,
  }
}

export type ParametrosGuardarCache = {
  empresaId: string
  service: ServicioAfip
  token: string
  sign: string
  expiresAt: Date
}

/**
 * Guarda (UPSERT) el TA en cache.
 */
export async function guardarTaEnCache(params: ParametrosGuardarCache): Promise<void> {
  const { empresaId, service, token, sign, expiresAt } = params
  const config = getAfipConfig()

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('afip_ta_cache')
    .upsert(
      {
        empresa_id: empresaId,
        service,
        modo: config.mode,
        cuit: config.cuit,
        token,
        sign,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'empresa_id,service,modo' }
    )

  if (error) {
    console.error('[AFIP/WSAA cache] Error guardando:', error.message)
    throw new Error(`No se pudo guardar el TA en cache: ${error.message}`)
  }

  console.log('[AFIP/WSAA cache] TA guardado, vence', expiresAt.toISOString())
}
