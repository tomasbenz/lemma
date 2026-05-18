// src/lib/queries/usuarios.ts
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type UsuarioListado = {
  id: string
  email: string
  nombre_completo: string
  rol: Database['public']['Enums']['user_role']
  activo: boolean
  ultimo_login_at: string | null
  created_at: string
}

/**
 * Lista todos los usuarios de la empresa del usuario logueado.
 *
 * RLS filtra automáticamente por empresa_id. El admin de una empresa
 * solo ve usuarios de su empresa; el superadmin impersonando ve los
 * de la empresa activa.
 */
export async function listarUsuarios(): Promise<UsuarioListado[]> {
  const supabase = await createClient()

  // Cargar el caller para saber si filtramos superadmins
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  let callerEsSuperadmin = false
  if (authUser) {
    const { data: callerData } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', authUser.id)
      .single()
    callerEsSuperadmin = callerData?.rol === 'superadmin'
  }

  let query = supabase
    .from('usuarios')
    .select(
      'id, email, nombre_completo, rol, activo, ultimo_login_at, created_at'
    )

  // Solo el superadmin se ve a sí mismo. Los admins comunes NO ven superadmins.
  if (!callerEsSuperadmin) {
    query = query.neq('rol', 'superadmin')
  }

  const { data, error } = await query
    .order('activo', { ascending: false })
    .order('rol', { ascending: true })
    .order('nombre_completo', { ascending: true })

  if (error) {
    console.error('[listarUsuarios] Error:', error.message)
    return []
  }

  return (data ?? []) as UsuarioListado[]
}

export async function obtenerUsuario(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[obtenerUsuario] Error:', error.message)
    return null
  }

  return data
}