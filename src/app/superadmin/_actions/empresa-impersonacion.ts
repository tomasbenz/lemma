// src/app/superadmin/_actions/empresa-impersonacion.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  setEmpresaActiva,
  clearEmpresaActiva,
} from '@/lib/auth/empresa-activa'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Activa el modo impersonación: el superadmin "entra" a una empresa.
 *
 * Implementación pragmática:
 * - Setea cookie `lp_empresa_activa` con el empresa_id
 * - Actualiza `usuarios.empresa_id` del superadmin a esa empresa
 *   (vía service_role para bypassear RLS de actualización)
 * - Como `get_empresa_id()` SQL lee de `usuarios.empresa_id`, ahora
 *   las RLS van a filtrar automáticamente por la empresa impersonada
 *   sin tocar ninguna query del resto de la app.
 *
 * Cuando sale, se borra la cookie y se vuelve a poner empresa_id = NULL.
 */
export async function entrarAEmpresa(empresaId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.rol !== 'superadmin') {
    throw new Error('No autorizado')
  }

  const admin = createAdminClient()

  // Validar empresa
  const { data: empresa, error } = await admin
    .from('empresas')
    .select('id, activo')
    .eq('id', empresaId)
    .single()

  if (error || !empresa) {
    throw new Error('Empresa no encontrada')
  }

  if (!empresa.activo) {
    throw new Error('Empresa desactivada')
  }

  // Setear cookie + actualizar empresa_id del superadmin en tabla usuarios
  await setEmpresaActiva(empresaId)

  const { error: errUpdate } = await admin
    .from('usuarios')
    .update({ empresa_id: empresaId })
    .eq('id', user.id)

  if (errUpdate) {
    console.error('[entrarAEmpresa] Error actualizando empresa_id:', errUpdate)
    throw new Error('Error al activar empresa')
  }

  revalidatePath('/', 'layout')
  redirect('/admin')
}

/**
 * Desactiva el modo impersonación: el superadmin vuelve al panel /superadmin.
 * Restaura empresa_id = NULL en su fila de usuarios.
 */
export async function salirDeEmpresa(): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.rol !== 'superadmin') {
    throw new Error('No autorizado')
  }

  const admin = createAdminClient()

  // Borrar cookie + volver empresa_id a NULL
  await clearEmpresaActiva()

  await admin
    .from('usuarios')
    .update({ empresa_id: null })
    .eq('id', user.id)

  revalidatePath('/', 'layout')
  redirect('/superadmin')
}