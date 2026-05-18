// src/lib/queries/configuracion.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import type { Configuracion } from './configuracion-types'

/**
 * Devuelve la configuración de la empresa del usuario logueado.
 * Filtra por empresa_id (no por id=1 hardcodeado, eso era pre-multitenant).
 */
export async function obtenerConfiguracion(): Promise<Configuracion> {
  const fallback: Configuracion = {
    razon_social: 'Sin configurar',
    nombre_fantasia: null,
    cuit: '00-00000000-0',
    condicion_iva: 'IVA Responsable Inscripto',
    ingresos_brutos: null,
    inicio_actividades: null,
    domicilio: null,
    localidad: null,
    provincia: null,
    codigo_postal: null,
    telefono: null,
    email: null,
    web: null,
    punto_venta_default: 1,
    puntos_venta: [1],
    umbral_stock_bajo: 5,
    updated_at: new Date().toISOString(),
  }

  const user = await getCurrentUser()
  if (!user || !user.empresa_id) return fallback

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('configuracion')
    .select('*')
    .eq('empresa_id', user.empresa_id)
    .single()

  if (error || !data) {
    console.error('[obtenerConfiguracion]', error)
    return fallback
  }

  const puntos_venta_raw = (data as { puntos_venta?: number[] | null })
    .puntos_venta
  const puntos_venta =
    Array.isArray(puntos_venta_raw) && puntos_venta_raw.length > 0
      ? puntos_venta_raw
      : [data.punto_venta_default ?? 1]

  return {
    razon_social: data.razon_social,
    // Cast defensivo: el regen de database.ts puede quedar stale por encoding.
    // Cuando se confirme propagación, simplificar a `data.nombre_fantasia ?? null`.
    nombre_fantasia:
      (data as { nombre_fantasia?: string | null }).nombre_fantasia ?? null,
    cuit: data.cuit,
    condicion_iva: data.condicion_iva,
    ingresos_brutos: data.ingresos_brutos,
    inicio_actividades: data.inicio_actividades,
    domicilio: data.domicilio,
    localidad: data.localidad,
    provincia: data.provincia,
    codigo_postal: data.codigo_postal,
    telefono: data.telefono,
    email: data.email,
    web: data.web,
    punto_venta_default: data.punto_venta_default,
    puntos_venta,
    umbral_stock_bajo:
      (data as { umbral_stock_bajo?: number }).umbral_stock_bajo ?? 5,
    updated_at: data.updated_at,
  }
}