// src/app/(app)/admin/turnos/_actions/forzar-cierre-turno.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type ForzarCierreTurnoInput = {
  turnoId: string
  motivo: string
}

export type ForzarCierreTurnoResult =
  | { ok: true }
  | { ok: false; error: string }

export async function forzarCierreTurno(
  input: ForzarCierreTurnoInput
): Promise<ForzarCierreTurnoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }

    if (user.rol !== 'admin' && user.rol !== 'superadmin') {
      return { ok: false, error: 'Solo admin puede forzar el cierre' }
    }

    if (!input.turnoId) {
      return { ok: false, error: 'Falta el ID del turno' }
    }
    const motivoLimpio = input.motivo?.trim()
    if (!motivoLimpio) {
      return { ok: false, error: 'El motivo es obligatorio' }
    }

    const supabase = await createClient()

    // Pre-check: admin solo puede forzar turnos de su propia empresa.
    // Superadmin sin empresa activa puede forzar en cualquier empresa
    // (paralelo a anular_venta, la RPC también lo permite).
    if (user.rol !== 'superadmin' && user.empresa_id) {
      const { data: turnoRow, error: turnoError } = await supabase
        .from('turnos_caja')
        .select('id, empresa_id, cerrado_at')
        .eq('id', input.turnoId)
        .eq('empresa_id', user.empresa_id)
        .maybeSingle()

      if (turnoError) {
        console.error('[forzarCierreTurno] pre-check:', turnoError)
        return { ok: false, error: 'No se pudo validar el turno' }
      }
      if (!turnoRow) {
        return { ok: false, error: 'El turno no existe' }
      }
      if (turnoRow.cerrado_at) {
        return { ok: false, error: 'El turno ya está cerrado' }
      }
    }

    const { error } = await supabase.rpc('forzar_cierre_turno', {
      p_turno_id: input.turnoId,
      p_motivo: motivoLimpio,
    })

    if (error) {
      console.error('[forzarCierreTurno] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al forzar cierre',
      }
    }

    revalidatePath('/caja')
    revalidatePath('/admin/turnos')
    revalidatePath(`/admin/turnos/${input.turnoId}`)

    return { ok: true }
  } catch (err) {
    console.error('[forzarCierreTurno] Error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}
