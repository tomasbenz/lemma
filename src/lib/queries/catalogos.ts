// src/lib/queries/catalogos.ts
import { createClient } from '@/lib/supabase/server'

export type CatalogoItem = {
  id: string
  nombre: string
  nombre_normalizado: string
  orden: number
}

export type CatalogoItemAdmin = {
  id: string
  nombre: string
  nombre_normalizado: string
  orden: number
  activo: boolean
  hex?: string | null
  uso_count: number
}

/**
 * Lista colores del catálogo (solo activos, para uso en formularios).
 */
export async function listarColores(): Promise<CatalogoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalogo_colores')
    .select('id, nombre, nombre_normalizado, orden')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarColores] Error:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Lista talles del catálogo (solo activos).
 */
export async function listarTalles(): Promise<CatalogoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalogo_talles')
    .select('id, nombre, nombre_normalizado, orden')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarTalles] Error:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Lista categorías de productos (solo activas).
 * Para usar en selectores al crear/editar productos.
 */
export async function listarCategorias(): Promise<CatalogoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalogo_categorias')
    .select('id, nombre, nombre_normalizado, orden')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarCategorias] Error:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Lista TODOS los colores (activos + inactivos) con count de uso.
 */
export async function listarColoresAdmin(): Promise<CatalogoItemAdmin[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('catalogo_colores')
    .select('id, nombre, nombre_normalizado, orden, activo, hex')
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarColoresAdmin] Error:', error.message)
    return []
  }

  const items: CatalogoItemAdmin[] = await Promise.all(
    (data ?? []).map(async (c) => {
      const { count } = await supabase
        .from('variantes')
        .select('id', { count: 'exact', head: true })
        .eq('color', c.nombre)
      return {
        ...c,
        uso_count: count ?? 0,
      }
    })
  )

  return items
}

/**
 * Lista TODOS los talles (activos + inactivos) con count de uso.
 */
export async function listarTallesAdmin(): Promise<CatalogoItemAdmin[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('catalogo_talles')
    .select('id, nombre, nombre_normalizado, orden, activo')
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarTallesAdmin] Error:', error.message)
    return []
  }

  const items: CatalogoItemAdmin[] = await Promise.all(
    (data ?? []).map(async (t) => {
      const { count } = await supabase
        .from('variantes')
        .select('id', { count: 'exact', head: true })
        .eq('talle', t.nombre)
      return {
        ...t,
        hex: null,
        uso_count: count ?? 0,
      }
    })
  )

  return items
}

/**
 * Lista TODAS las categorías (activas + inactivas) con count de uso.
 * Cuenta productos.categoria coincidente por nombre.
 */
export async function listarCategoriasAdmin(): Promise<CatalogoItemAdmin[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('catalogo_categorias')
    .select('id, nombre, nombre_normalizado, orden, activo')
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarCategoriasAdmin] Error:', error.message)
    return []
  }

  const items: CatalogoItemAdmin[] = await Promise.all(
    (data ?? []).map(async (c) => {
      const { count } = await supabase
        .from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('categoria', c.nombre)
        .eq('activo', true)
      return {
        ...c,
        hex: null,
        uso_count: count ?? 0,
      }
    })
  )

  return items
}