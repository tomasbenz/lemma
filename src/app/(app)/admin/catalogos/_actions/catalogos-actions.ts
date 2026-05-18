// src/app/(app)/admin/catalogos/_actions/catalogos-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'

/**
 * El refactor de Lemma eliminó las tablas `catalogo_colores` y `catalogo_talles`.
 * Solo queda `catalogo_categorias`. Los atributos de variante (color, formato,
 * gramaje, etc.) viven ahora en `categoria_atributos` con CRUD propio.
 */
type Tabla = 'catalogo_categorias'

type SimpleResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

type CrearResult =
  | { ok: true; id: string }
  | { ok: false; error: string; field?: string }

function normalizar(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

async function authzAdmin(): Promise<
  | { ok: true; empresaId: string }
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
  return { ok: true, empresaId: user.empresa_id }
}

// ============================================================
// CREAR item
// ============================================================

export type CrearItemInput = {
  tabla: Tabla
  nombre: string
  orden?: number
}

export async function crearCatalogoItem(
  input: CrearItemInput
): Promise<CrearResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    const nombre = input.nombre.trim()
    if (!nombre || nombre.length < 1 || nombre.length > 50) {
      return {
        ok: false,
        error: 'Nombre inválido (1-50 caracteres)',
        field: 'nombre',
      }
    }

    const nombreNorm = normalizar(nombre)

    const supabase = await createClient()

    const { data: existente } = await supabase
      .from(input.tabla)
      .select('id, activo')
      .eq('empresa_id', authz.empresaId)
      .eq('nombre_normalizado', nombreNorm)
      .maybeSingle()

    if (existente) {
      if (!existente.activo) {
        const { error: errUpdate } = await supabase
          .from(input.tabla)
          .update({ activo: true, nombre } as never)
          .eq('id', existente.id)

        if (errUpdate) return { ok: false, error: errUpdate.message }

        revalidatePath('/admin/catalogos')
        return { ok: true, id: existente.id }
      }
      return {
        ok: false,
        error: 'Ya existe un ítem con ese nombre',
        field: 'nombre',
      }
    }

    const { data, error } = await supabase
      .from(input.tabla)
      .insert({
        empresa_id: authz.empresaId,
        nombre,
        nombre_normalizado: nombreNorm,
        orden: input.orden ?? 0,
        activo: true,
      } as never)
      .select('id')
      .single()

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Error creando ítem' }
    }

    revalidatePath('/admin/catalogos')
    return { ok: true, id: data.id }
  } catch (err) {
    console.error('[crearCatalogoItem] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

// ============================================================
// EDITAR item
// ============================================================

export type EditarItemInput = {
  tabla: Tabla
  id: string
  nombre: string
  orden: number
}

export async function editarCatalogoItem(
  input: EditarItemInput
): Promise<SimpleResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    const nombre = input.nombre.trim()
    if (!nombre || nombre.length < 1 || nombre.length > 50) {
      return {
        ok: false,
        error: 'Nombre inválido (1-50 caracteres)',
        field: 'nombre',
      }
    }

    const nombreNorm = normalizar(nombre)

    const supabase = await createClient()

    const { data: actual } = await supabase
      .from(input.tabla)
      .select('id, empresa_id, nombre_normalizado')
      .eq('id', input.id)
      .single()

    if (!actual) return { ok: false, error: 'Ítem no encontrado' }
    if (actual.empresa_id !== authz.empresaId) {
      return { ok: false, error: 'No tenés permisos sobre este ítem' }
    }

    if (actual.nombre_normalizado !== nombreNorm) {
      const { data: choque } = await supabase
        .from(input.tabla)
        .select('id')
        .eq('empresa_id', authz.empresaId)
        .eq('nombre_normalizado', nombreNorm)
        .neq('id', input.id)
        .maybeSingle()

      if (choque) {
        return {
          ok: false,
          error: 'Ya existe otro ítem con ese nombre',
          field: 'nombre',
        }
      }
    }

    const { error } = await supabase
      .from(input.tabla)
      .update({
        nombre,
        nombre_normalizado: nombreNorm,
        orden: input.orden,
      } as never)
      .eq('id', input.id)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/admin/catalogos')
    return { ok: true }
  } catch (err) {
    console.error('[editarCatalogoItem] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

// ============================================================
// DESACTIVAR / REACTIVAR
// ============================================================

export async function setCatalogoItemActivo(
  tabla: Tabla,
  id: string,
  activo: boolean
): Promise<SimpleResult> {
  try {
    const authz = await authzAdmin()
    if (!authz.ok) return { ok: false, error: authz.error }

    const supabase = await createClient()

    const { data: actual } = await supabase
      .from(tabla)
      .select('id, empresa_id')
      .eq('id', id)
      .single()

    if (!actual) return { ok: false, error: 'Ítem no encontrado' }
    if (actual.empresa_id !== authz.empresaId) {
      return { ok: false, error: 'No tenés permisos sobre este ítem' }
    }

    const { error } = await supabase
      .from(tabla)
      .update({ activo } as never)
      .eq('id', id)

    if (error) return { ok: false, error: error.message }

    revalidatePath('/admin/catalogos')
    return { ok: true }
  } catch (err) {
    console.error('[setCatalogoItemActivo] Error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
