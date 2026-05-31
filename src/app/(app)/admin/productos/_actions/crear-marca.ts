'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'

export type CrearMarcaResult =
  | { ok: true; id: string; nombre: string; nombre_normalizado: string }
  | { ok: false; error: string }

/**
 * Normaliza el nombre de marca igual que `normalizar_busqueda` en la DB
 * (lower + sin tildes + espacios colapsados), para que el UNIQUE
 * (empresa_id, nombre_normalizado) matchee y no se dupliquen marcas.
 */
function normalizarNombre(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ')
}

/**
 * Crea (o reusa) una marca de la empresa actual y devuelve su id. Pensada para
 * el alta "al vuelo" desde el form de producto: si la marca ya existe (por
 * nombre normalizado) devuelve la existente; si no, la inserta.
 *
 * Las categorías reales NO tienen un equivalente acá a propósito: son curated
 * y se administran desde Catálogos.
 */
export async function crearMarca(nombreRaw: string): Promise<CrearMarcaResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sin empresa activa' }

    const nombre = nombreRaw.trim()
    if (nombre.length < 1 || nombre.length > 100) {
      return { ok: false, error: 'El nombre de la marca es inválido' }
    }
    const nombre_normalizado = normalizarNombre(nombre)

    const supabase = await createClient()

    // ¿Ya existe? (defense in depth + evita el roundtrip de INSERT que falla)
    const { data: existente } = await supabase
      .from('marcas')
      .select('id, nombre, nombre_normalizado')
      .eq('empresa_id', user.empresa_id)
      .eq('nombre_normalizado', nombre_normalizado)
      .maybeSingle()

    if (existente) {
      return {
        ok: true,
        id: existente.id,
        nombre: existente.nombre,
        nombre_normalizado: existente.nombre_normalizado,
      }
    }

    const { data: creada, error } = await supabase
      .from('marcas')
      .insert({ empresa_id: user.empresa_id, nombre, nombre_normalizado })
      .select('id, nombre, nombre_normalizado')
      .single()

    if (error || !creada) {
      // Posible carrera: otro request la creó en paralelo (viola el UNIQUE).
      const { data: retry } = await supabase
        .from('marcas')
        .select('id, nombre, nombre_normalizado')
        .eq('empresa_id', user.empresa_id)
        .eq('nombre_normalizado', nombre_normalizado)
        .maybeSingle()
      if (retry) {
        return {
          ok: true,
          id: retry.id,
          nombre: retry.nombre,
          nombre_normalizado: retry.nombre_normalizado,
        }
      }
      console.error('[crearMarca] Error insertando marca:', error)
      return { ok: false, error: error?.message ?? 'No se pudo crear la marca' }
    }

    revalidatePath('/admin/productos')
    revalidatePath('/admin/catalogos')

    return {
      ok: true,
      id: creada.id,
      nombre: creada.nombre,
      nombre_normalizado: creada.nombre_normalizado,
    }
  } catch (err) {
    console.error('[crearMarca] Error inesperado:', err)
    return { ok: false, error: 'Error inesperado' }
  }
}
