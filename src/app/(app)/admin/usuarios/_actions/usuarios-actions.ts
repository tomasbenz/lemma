// src/app/(app)/admin/usuarios/_actions/usuarios-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type UserRole = Database['public']['Enums']['user_role']

type SimpleResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

type CrearResult =
  | { ok: true; usuarioId: string }
  | { ok: false; error: string; field?: string }

/**
 * Asegura que el caller es admin o superadmin de su empresa.
 * Devuelve la empresa_id sobre la que tiene derechos de gestión.
 */
async function authzAdmin(): Promise<
  | { ok: true; empresaId: string; callerId: string }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'No autenticado' }
  if (user.rol === 'vendedor') {
    return { ok: false, error: 'No tenés permisos' }
  }
  if (!user.empresa_id) {
    return { ok: false, error: 'Sin empresa activa' }
  }
  return { ok: true, empresaId: user.empresa_id, callerId: user.id }
}

// ============================================================
// CREAR usuario
// ============================================================

export type CrearUsuarioInput = {
  email: string
  password: string
  nombre_completo: string
  rol: UserRole
}

export async function crearUsuario(
  input: CrearUsuarioInput
): Promise<CrearResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    const email = input.email.trim().toLowerCase()
    const nombre = input.nombre_completo.trim()
    const password = input.password
    const rol = input.rol

    // Validaciones
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'Email inválido', field: 'email' }
    }
    if (!nombre || nombre.length < 2) {
      return {
        ok: false,
        error: 'Nombre demasiado corto',
        field: 'nombre_completo',
      }
    }
    if (!password || password.length < 8) {
      return {
        ok: false,
        error: 'Password debe tener al menos 8 caracteres',
        field: 'password',
      }
    }
    if (!['admin', 'vendedor', 'superadmin'].includes(rol)) {
      return { ok: false, error: 'Rol inválido', field: 'rol' }
    }

    // Solo superadmin puede crear superadmins
    const caller = await getCurrentUser()
    if (rol === 'superadmin' && caller?.rol !== 'superadmin') {
      return { ok: false, error: 'No podés crear superadmins', field: 'rol' }
    }

    const admin = createAdminClient()

    // Verificar email no existente
    const { data: existente } = await admin
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existente) {
      return {
        ok: false,
        error: 'Ya existe un usuario con ese email',
        field: 'email',
      }
    }

    // Crear en Supabase Auth con metadata
    const { data: authData, error: errAuth } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          nombre_completo: nombre,
          rol,
          empresa_id: authz.empresaId,
        },
      })

    if (errAuth || !authData.user) {
      console.error('[crearUsuario] Error auth:', errAuth)
      return {
        ok: false,
        error: errAuth?.message ?? 'Error creando usuario',
      }
    }

    // El trigger handle_new_user crea la fila en public.usuarios.
    // Forzamos los valores por las dudas (a veces el trigger no pega
    // todos los metadata).
    const { error: errUpsert } = await admin
      .from('usuarios')
      .update({
        nombre_completo: nombre,
        rol,
        empresa_id: authz.empresaId,
        activo: true,
      })
      .eq('id', authData.user.id)

    if (errUpsert) {
      console.error('[crearUsuario] Error update:', errUpsert)
      // Rollback: borrar el auth user que quedó huérfano
      await admin.auth.admin.deleteUser(authData.user.id)
      return { ok: false, error: 'Error guardando datos del usuario' }
    }

    revalidatePath('/admin/usuarios')
    return { ok: true, usuarioId: authData.user.id }
  } catch (err) {
    console.error('[crearUsuario] Error inesperado:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

// ============================================================
// EDITAR usuario (nombre + rol)
// ============================================================

export type EditarUsuarioInput = {
  id: string
  nombre_completo: string
  rol: UserRole
}

export async function editarUsuario(
  input: EditarUsuarioInput
): Promise<SimpleResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    const nombre = input.nombre_completo.trim()
    if (!nombre || nombre.length < 2) {
      return {
        ok: false,
        error: 'Nombre demasiado corto',
        field: 'nombre_completo',
      }
    }
    if (!['admin', 'vendedor', 'superadmin'].includes(input.rol)) {
      return { ok: false, error: 'Rol inválido', field: 'rol' }
    }

    const caller = await getCurrentUser()
    if (input.rol === 'superadmin' && caller?.rol !== 'superadmin') {
      return { ok: false, error: 'No podés asignar rol superadmin' }
    }

    const admin = createAdminClient()

    // Validar que el usuario pertenece a la empresa del caller
    const { data: target } = await admin
      .from('usuarios')
      .select('id, empresa_id, rol')
      .eq('id', input.id)
      .single()

    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.empresa_id !== authz.empresaId) {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    // Defense in depth: admin común no puede mutar superadmins
    if (target.rol === 'superadmin' && caller?.rol !== 'superadmin') {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    // No permitir que un admin común se baje a sí mismo de admin
    if (
      input.id === authz.callerId &&
      target.rol === 'admin' &&
      input.rol !== 'admin'
    ) {
      return { ok: false, error: 'No podés cambiar tu propio rol' }
    }

    const { error } = await admin
      .from('usuarios')
      .update({
        nombre_completo: nombre,
        rol: input.rol,
      })
      .eq('id', input.id)

    if (error) {
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[editarUsuario] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

// ============================================================
// DESACTIVAR / REACTIVAR
// ============================================================

export async function setUsuarioActivo(
  id: string,
  activo: boolean
): Promise<SimpleResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    if (id === authz.callerId) {
      return { ok: false, error: 'No podés desactivarte a vos mismo' }
    }

    const admin = createAdminClient()
    const { data: target } = await admin
      .from('usuarios')
      .select('id, empresa_id, rol')
      .eq('id', id)
      .single()

    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.empresa_id !== authz.empresaId) {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    // Defense in depth: admin común no puede tocar superadmins
    const caller = await getCurrentUser()
    if (target.rol === 'superadmin' && caller?.rol !== 'superadmin') {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    const { error } = await admin
      .from('usuarios')
      .update({ activo })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/admin/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[setUsuarioActivo] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

// ============================================================
// RESETEAR PASSWORD
// ============================================================

export async function resetearPassword(
  id: string,
  nuevaPassword: string
): Promise<SimpleResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    if (!nuevaPassword || nuevaPassword.length < 8) {
      return {
        ok: false,
        error: 'Password debe tener al menos 8 caracteres',
        field: 'password',
      }
    }

    const admin = createAdminClient()
    const { data: target } = await admin
      .from('usuarios')
      .select('id, empresa_id, rol')
      .eq('id', id)
      .single()

    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.empresa_id !== authz.empresaId) {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    // Defense in depth: admin común no puede resetear password de superadmins
    const caller = await getCurrentUser()
    if (target.rol === 'superadmin' && caller?.rol !== 'superadmin') {
      return { ok: false, error: 'No tenés permisos sobre este usuario' }
    }

    const { error } = await admin.auth.admin.updateUserById(id, {
      password: nuevaPassword,
    })

    if (error) return { ok: false, error: error.message }

    revalidatePath('/admin/usuarios')
    return { ok: true }
  } catch (err) {
    console.error('[resetearPassword] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}