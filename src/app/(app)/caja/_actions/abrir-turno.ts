// src/app/(app)/caja/_actions/abrir-turno.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type AbrirTurnoInput = {
  baseInicial: number
  notaApertura?: string
}

export type AbrirTurnoResult =
  | { ok: true; turnoId: string }
  | { ok: false; error: string }

export async function abrirTurno(
  input: AbrirTurnoInput
): Promise<AbrirTurnoResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!user.empresa_id) {
      return { ok: false, error: 'Usuario sin empresa asignada' }
    }

    if (
      input.baseInicial === undefined ||
      input.baseInicial === null ||
      Number.isNaN(input.baseInicial) ||
      input.baseInicial < 0
    ) {
      return {
        ok: false,
        error: 'La base inicial debe ser un número mayor o igual a cero',
      }
    }

    const supabase = await createClient()

    // Resolver caja default de la empresa. Para single-caja (Samu) es
    // determinístico; cuando soportemos multi-caja, este action va a
    // recibir caja_id desde el cliente.
    const { data: cajaIdRaw, error: cajaError } = await supabase.rpc(
      'get_default_caja_id',
      { p_empresa_id: user.empresa_id }
    )

    if (cajaError) {
      console.error('[abrirTurno] get_default_caja_id:', cajaError)
      return { ok: false, error: 'No se pudo resolver la caja default' }
    }

    const cajaId = cajaIdRaw as unknown as string | null
    if (!cajaId) {
      return { ok: false, error: 'No hay caja configurada para la empresa' }
    }

    const { data, error } = await supabase.rpc('abrir_turno', {
      p_caja_id: cajaId,
      p_base_inicial: input.baseInicial,
      p_nota_apertura: input.notaApertura?.trim() || undefined,
    })

    if (error) {
      console.error('[abrirTurno] Error RPC:', error)
      return { ok: false, error: error.message || 'Error al abrir el turno' }
    }

    const turno = data as unknown as { id?: string } | null
    if (!turno?.id) {
      return { ok: false, error: 'Respuesta inválida del servidor' }
    }

    revalidatePath('/caja')
    revalidatePath('/admin/turnos')

    return { ok: true, turnoId: turno.id }
  } catch (err) {
    console.error('[abrirTurno] Error inesperado:', err)
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}
