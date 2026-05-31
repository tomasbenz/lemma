'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito } from '@/lib/cobro/calculos'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CAP = 1000

export type AplicarAumentoWorkspaceInput = {
  /** Precios YA redondeados en TS con redondearPrecio(). */
  cambios: Array<{ id: string; precio_nuevo: number }>
  /** Obligatorio, ≤ 200 chars. */
  motivo: string
}

export type AplicarAumentoWorkspaceResultado = {
  ok: boolean
  operacion_id: string | null
  afectados: number
  error?: string
}

export async function aplicarAumentoWorkspace(
  input: AplicarAumentoWorkspaceInput
): Promise<AplicarAumentoWorkspaceResultado> {
  const fail = (error: string): AplicarAumentoWorkspaceResultado => ({
    ok: false,
    operacion_id: null,
    afectados: 0,
    error,
  })

  try {
    const user = await getCurrentUser()
    if (!user) return fail('No autenticado')
    if (!puedeEditarCatalogo(user.rol)) return fail('No tenés permisos')
    if (!user.empresa_id) return fail('Sesión inválida')

    const motivo = typeof input.motivo === 'string' ? input.motivo.trim() : ''
    if (motivo.length === 0) return fail('El motivo es obligatorio')
    if (motivo.length > 200) return fail('El motivo no puede superar 200 caracteres')

    if (!Array.isArray(input.cambios) || input.cambios.length === 0) {
      return fail('No hay productos para actualizar')
    }
    if (input.cambios.length > CAP) {
      return fail('Máximo 1000 productos por operación')
    }

    // El precio debe ser > 0: la RPC rechaza precio <= 0 y haría rollback de todo
    // el lote. Un producto que quedó en $0 por redondeo se quita en el preview.
    const cambios: Array<{ id: string; precio: number }> = []
    for (const c of input.cambios) {
      if (!c || typeof c.id !== 'string' || !UUID_RE.test(c.id)) {
        return fail('Hay un producto inválido en la lista')
      }
      if (!esMontoFinito(c.precio_nuevo) || c.precio_nuevo <= 0) {
        return fail('Hay precios en $0 o inválidos. Quitalos o cambiá el redondeo.')
      }
      cambios.push({ id: c.id, precio: c.precio_nuevo })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('productos_bulk_precio_individual', {
      p_usuario_id: user.id,
      p_cambios: cambios,
      p_motivo: motivo,
      p_accion: 'aumento_workspace',
    })

    if (error) {
      console.error('[aplicarAumentoWorkspace] Error RPC:', error.message)
      return fail(error.message || 'Error al aplicar el aumento')
    }

    const r = data as {
      ok?: boolean
      operacion_id?: string
      afectados?: number
    }
    if (!r?.ok) return fail('No se pudo aplicar el aumento')

    revalidatePath('/admin/productos')
    revalidatePath('/admin/productos/aumentos')
    revalidatePath('/admin/operaciones')

    return {
      ok: true,
      operacion_id: r.operacion_id ?? null,
      afectados: r.afectados ?? 0,
    }
  } catch (error) {
    console.error('[aplicarAumentoWorkspace] inesperado:', error)
    return fail('Error inesperado')
  }
}
