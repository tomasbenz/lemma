// src/app/(app)/caja/_actions/cerrar-turno.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type CerrarTurnoInput = {
  turnoId: string
  totalDeclarado: number
  notaCierre?: string
}

export type CerrarTurnoResult =
  | { ok: true; resumen: unknown }
  | { ok: false; error: string }

export async function cerrarTurno(
  input: CerrarTurnoInput
): Promise<CerrarTurnoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!user.empresa_id) {
      return { ok: false, error: 'Usuario sin empresa asignada' }
    }

    if (!input.turnoId) {
      return { ok: false, error: 'Falta el ID del turno' }
    }
    if (
      input.totalDeclarado === undefined ||
      input.totalDeclarado === null ||
      Number.isNaN(input.totalDeclarado) ||
      input.totalDeclarado < 0
    ) {
      return {
        ok: false,
        error: 'El total declarado debe ser un número mayor o igual a cero',
      }
    }

    const supabase = await createClient()

    // Pre-check: el turno pertenece a la empresa del caller y está abierto.
    const { data: turnoRow, error: turnoError } = await supabase
      .from('turnos_caja')
      .select('id, empresa_id, cerrado_at')
      .eq('id', input.turnoId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (turnoError) {
      console.error('[cerrarTurno] pre-check:', turnoError)
      return { ok: false, error: 'No se pudo validar el turno' }
    }
    if (!turnoRow) {
      return { ok: false, error: 'El turno no existe' }
    }
    if (turnoRow.cerrado_at) {
      return { ok: false, error: 'El turno ya está cerrado' }
    }

    const { data, error } = await supabase.rpc('cerrar_turno', {
      p_turno_id: input.turnoId,
      p_total_declarado: input.totalDeclarado,
      p_nota_cierre: input.notaCierre?.trim() || undefined,
    })

    if (error) {
      console.error('[cerrarTurno] Error RPC:', error)
      return { ok: false, error: error.message || 'Error al cerrar el turno' }
    }

    revalidatePath('/caja')
    revalidatePath('/admin/turnos')
    revalidatePath(`/admin/turnos/${input.turnoId}`)

    return { ok: true, resumen: data }
  } catch (err) {
    console.error('[cerrarTurno] Error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}
