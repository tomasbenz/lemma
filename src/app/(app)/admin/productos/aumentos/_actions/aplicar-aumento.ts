'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito } from '@/lib/cobro/calculos'
import {
  esEstrategiaRedondeo,
  type EstrategiaRedondeo,
} from '@/lib/precios/redondeo'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AplicarAjuste = { categoria_id: string; pct: number }

export type AplicarAumentoInput = {
  marca_id: string | null
  ajustes: AplicarAjuste[]
  redondeo: EstrategiaRedondeo
  /** Texto libre obligatorio, ej: "Suba proveedor Filgo 28-may". */
  motivo: string
}

export type AplicarAumentoResultado =
  | {
      ok: true
      operacionId?: string
      afectados: number
      porCategoria: { categoria_id: string; n_productos: number }[]
    }
  | { ok: false; error: string }

/**
 * Aplica el aumento por categoría vía la RPC atómica
 * `aumentar_precios_por_categoria` (migración 021).
 *
 * Validación client-side = defense in depth: la RPC valida igual.
 */
export async function aplicarAumento(
  input: AplicarAumentoInput
): Promise<AplicarAumentoResultado> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    if (!esEstrategiaRedondeo(input.redondeo)) {
      return { ok: false, error: 'Redondeo inválido' }
    }
    if (input.marca_id !== null && !UUID_RE.test(input.marca_id)) {
      return { ok: false, error: 'Marca inválida' }
    }

    const motivo = typeof input.motivo === 'string' ? input.motivo.trim() : ''
    if (motivo.length === 0) {
      return { ok: false, error: 'El motivo es obligatorio' }
    }
    if (motivo.length > 200) {
      return { ok: false, error: 'El motivo no puede superar 200 caracteres' }
    }

    if (!Array.isArray(input.ajustes) || input.ajustes.length === 0) {
      return { ok: false, error: 'No hay ajustes por categoría' }
    }

    // Quedarnos solo con los ajustes con pct distinto de 0 (los 0 no se tocan).
    const ajustes: AplicarAjuste[] = []
    for (const a of input.ajustes) {
      if (!a || typeof a.categoria_id !== 'string' || !UUID_RE.test(a.categoria_id)) {
        return { ok: false, error: 'Categoría inválida en los ajustes' }
      }
      if (!esMontoFinito(a.pct) || a.pct <= -100) {
        return { ok: false, error: 'Porcentaje inválido (debe ser > -100)' }
      }
      if (a.pct !== 0) ajustes.push({ categoria_id: a.categoria_id, pct: a.pct })
    }
    if (ajustes.length === 0) {
      return { ok: false, error: 'Cargá al menos un porcentaje distinto de 0' }
    }

    const supabase = await createClient()

    const { data, error } = await supabase.rpc(
      'aumentar_precios_por_categoria',
      {
        p_usuario_id: user.id,
        // null = todas las marcas → se omite para que la RPC use DEFAULT NULL.
        p_marca_id: input.marca_id ?? undefined,
        p_ajustes: ajustes,
        p_redondeo: input.redondeo,
        p_motivo: motivo,
      }
    )

    if (error) {
      console.error('[aplicarAumento] Error RPC:', error.message)
      return { ok: false, error: error.message || 'Error al aplicar el aumento' }
    }

    const r = data as {
      ok?: boolean
      operacion_id?: string
      afectados?: number
      por_categoria?: { categoria_id: string; n_productos: number }[]
    }
    if (!r?.ok) {
      return { ok: false, error: 'No se pudo aplicar el aumento' }
    }

    revalidatePath('/admin/productos')
    revalidatePath('/admin/productos/aumentos')
    revalidatePath('/admin/operaciones')

    return {
      ok: true,
      operacionId: r.operacion_id,
      afectados: r.afectados ?? 0,
      porCategoria: r.por_categoria ?? [],
    }
  } catch (error) {
    console.error('[aplicarAumento] inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
