'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RevertirOperacionResultado = {
  ok: boolean
  nueva_operacion_id: string | null
  afectados: number
  error?: string
}

export async function revertirOperacion(
  operacionId: string
): Promise<RevertirOperacionResultado> {
  const fail = (error: string): RevertirOperacionResultado => ({
    ok: false,
    nueva_operacion_id: null,
    afectados: 0,
    error,
  })

  try {
    const user = await getCurrentUser()
    if (!user) return fail('No autenticado')
    if (!puedeEditarCatalogo(user.rol)) return fail('No tenés permisos')
    if (!user.empresa_id) return fail('Sesión inválida')
    if (typeof operacionId !== 'string' || !UUID_RE.test(operacionId)) {
      return fail('Operación inválida')
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('revertir_operacion_precios', {
      p_usuario_id: user.id,
      p_operacion_original_id: operacionId,
    })

    if (error) {
      console.error('[revertirOperacion] Error RPC:', error.message)
      return fail(error.message || 'No se pudo revertir la operación')
    }

    const r = data as {
      ok?: boolean
      nueva_operacion_id?: string
      afectados?: number
    }
    if (!r?.ok) return fail('No se pudo revertir la operación')

    revalidatePath('/admin/operaciones')
    revalidatePath('/admin/productos')

    return {
      ok: true,
      nueva_operacion_id: r.nueva_operacion_id ?? null,
      afectados: r.afectados ?? 0,
    }
  } catch (error) {
    console.error('[revertirOperacion] inesperado:', error)
    return fail('Error inesperado')
  }
}
