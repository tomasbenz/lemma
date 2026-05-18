'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeAjustarStock } from '@/lib/auth/permisos'

type Resultado =
  | { ok: true; stockAnterior: number; stockNuevo: number }
  | { ok: false; error: string }

export async function ajustarStock(
  varianteId: string,
  delta: number,
  motivo: string
): Promise<Resultado> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    // Admin / superadmin / vendedor: todos pueden ajustar stock con motivo.
    // La RPC ajustar_stock registra usuario+IP+motivo en audit_log.
    if (!puedeAjustarStock(user.rol)) {
      return { ok: false, error: 'No tenés permisos para ajustar stock' }
    }

    if (!varianteId) return { ok: false, error: 'Variante inválida' }
    if (!Number.isInteger(delta) || delta === 0) {
      return { ok: false, error: 'El ajuste debe ser distinto de cero' }
    }
    if (!motivo || motivo.trim().length < 3) {
      return { ok: false, error: 'El motivo es obligatorio (mín. 3 caracteres)' }
    }

    // Defense in depth sobre RLS: sin empresa_id no hay variante consultable.
    if (!user.empresa_id) {
      return { ok: false, error: 'La variante no existe' }
    }

    const supabase = await createClient()

    const { data: existe } = await supabase
      .from('variantes')
      .select('id')
      .eq('id', varianteId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (!existe) {
      return { ok: false, error: 'La variante no existe' }
    }

    const { data, error } = await supabase.rpc('ajustar_stock', {
      p_variante_id: varianteId,
      p_delta: delta,
      p_motivo: motivo.trim(),
      p_usuario_id: user.id,
    } as never)

    if (error) {
      console.error('[ajustarStock]', error)
      return {
        ok: false,
        error: error.message || 'Error al ajustar stock',
      }
    }

    const r = data as {
      ok?: boolean
      stock_anterior?: number
      stock_nuevo?: number
    }
    if (!r?.ok) {
      return { ok: false, error: 'No se pudo ajustar el stock' }
    }

    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos`, 'layout')

    return {
      ok: true,
      stockAnterior: r.stock_anterior ?? 0,
      stockNuevo: r.stock_nuevo ?? 0,
    }
  } catch (err) {
    console.error('[ajustarStock]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}