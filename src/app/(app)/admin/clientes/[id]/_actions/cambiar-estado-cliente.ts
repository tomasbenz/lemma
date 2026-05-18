'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

type ActionResult = { ok: true } | { ok: false; error: string }

export async function cambiarEstadoCliente(
  id: string,
  activo: boolean
): Promise<ActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) redirect('/login')
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }
    if (!user.empresa_id) {
      return { ok: false, error: 'No hay empresa activa' }
    }

    const supabase = await createClient()

    const { error } = await supabase
      .from('clientes')
      .update({ activo } as never)
      .eq('id', id)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[cambiarEstadoCliente]', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin/clientes')
    revalidatePath(`/admin/clientes/${id}`)

    return { ok: true }
  } catch (err) {
    console.error('[cambiarEstadoCliente]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}