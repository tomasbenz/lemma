// src/lib/auth/get-current-user.ts
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getEmpresaActiva } from '@/lib/auth/empresa-activa'
import type { Database } from '@/types/database'

type UserRole = Database['public']['Enums']['user_role']

export type CurrentUser = {
  id: string
  email: string
  nombre_completo: string
  rol: UserRole
  activo: boolean
  /**
   * Para admin/vendedor: su empresa_id real.
   * Para superadmin sin impersonar: null.
   * Para superadmin impersonando: empresa_id de la empresa activa
   * (también está actualizado en tabla usuarios para que RLS funcione).
   */
  empresa_id: string | null
  /**
   * true cuando el superadmin está impersonando una empresa.
   * Se usa para mostrar el banner "Operando como superadmin en X".
   */
  esta_impersonando: boolean
}

export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const supabase = await createClient()

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return null
    }

    const { data: dbUser, error: dbError } = await supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo, empresa_id')
      .eq('id', authUser.id)
      .single()

    if (dbError || !dbUser) {
      console.error('[getCurrentUser] dbError:', dbError?.message)
      return null
    }

    if (!dbUser.activo) {
      return null
    }

    // Si es superadmin con cookie de empresa activa, está impersonando.
    // empresa_id ya viene actualizado en la tabla por la impersonación.
    let estaImpersonando = false
    if (dbUser.rol === 'superadmin') {
      const empresaActiva = await getEmpresaActiva()
      estaImpersonando = !!empresaActiva && !!dbUser.empresa_id
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      nombre_completo: dbUser.nombre_completo,
      rol: dbUser.rol as UserRole,
      activo: dbUser.activo,
      empresa_id: dbUser.empresa_id ?? null,
      esta_impersonando: estaImpersonando,
    }
  }
)

export function getDefaultRoute(rol: UserRole): string {
  switch (rol) {
    case 'vendedor':
      return '/caja'
    case 'admin':
      return '/admin'
    case 'superadmin':
      return '/superadmin'
    default:
      return '/login'
  }
}