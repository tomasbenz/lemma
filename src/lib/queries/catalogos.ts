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
 * Lista categorías de productos activas. Usar al crear/editar productos.
 *
 * Nota: las tablas `catalogo_colores` y `catalogo_talles` de Loom Point
 * fueron eliminadas. Variantes ahora usan jsonb `atributos` (color, formato,
 * gramaje, etc.) y la definición por categoría vive en `categoria_atributos`.
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
 * Lista marcas activas (id + nombre + nombre_normalizado). Usar en el form de
 * producto (combobox de marca con búsqueda fuzzy y alta al vuelo).
 */
export async function listarMarcas(): Promise<CatalogoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marcas')
    .select('id, nombre, nombre_normalizado, orden')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarMarcas] Error:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Lista TODAS las categorías reales (activas + inactivas) con count de uso.
 * Cuenta productos enlazados por FK (productos.categoria_id = catalogo_categorias.id).
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
        .eq('categoria_id', c.id)
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

/**
 * Lista TODAS las marcas (activas + inactivas) con count de uso.
 * Cuenta productos enlazados por FK (productos.marca_id = marcas.id).
 * Misma forma que listarCategoriasAdmin para reusar la UI de CRUD.
 */
export async function listarMarcasAdmin(): Promise<CatalogoItemAdmin[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('marcas')
    .select('id, nombre, nombre_normalizado, orden, activo')
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarMarcasAdmin] Error:', error.message)
    return []
  }

  const items: CatalogoItemAdmin[] = await Promise.all(
    (data ?? []).map(async (m) => {
      const { count } = await supabase
        .from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('marca_id', m.id)
        .eq('activo', true)
      return {
        ...m,
        hex: null,
        uso_count: count ?? 0,
      }
    })
  )

  return items
}

export type CategoriaAtributo = {
  id: string
  categoria_id: string
  nombre: string
  tipo: string
  opciones: string[] | null
  obligatorio: boolean
  orden: number
  activo: boolean
}

/**
 * Lista los atributos esperados para una categoría. Usar al renderizar
 * dinámicamente el form de variantes de un producto: cada categoría puede
 * definir qué atributos espera (ej "color", "formato", "gramaje") y de qué
 * tipo (texto, número, selección).
 */
export async function listarAtributosPorCategoria(
  categoriaId: string,
): Promise<CategoriaAtributo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categoria_atributos')
    .select('id, categoria_id, nombre, tipo, opciones, obligatorio, orden, activo')
    .eq('categoria_id', categoriaId)
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarAtributosPorCategoria] Error:', error.message)
    return []
  }

  return (data ?? []).map((a) => ({
    id: a.id,
    categoria_id: a.categoria_id,
    nombre: a.nombre,
    tipo: a.tipo,
    opciones: Array.isArray(a.opciones)
      ? (a.opciones as string[])
      : null,
    obligatorio: a.obligatorio,
    orden: a.orden,
    activo: a.activo,
  }))
}
