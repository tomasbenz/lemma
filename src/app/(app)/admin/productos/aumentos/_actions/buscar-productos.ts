'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { escaparParaOrFilter } from '@/lib/queries/_helpers'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BULK_CAP = 1000
const PAGE_SIZE_MAX = 200
const PAGE_SIZE_DEFAULT = 50

const VISTA = 'productos_con_stock_total'
const COLS = 'id, nombre, sku_base, precio_neto, marca_id, marca_nombre, categoria_id, categoria_nombre, stock_total, activo'

export type SortAumento = 'nombre' | 'precio_desc' | 'precio_asc'

export type AumentoFiltros = {
  marca_id: string | null
  categoria_id: string | null
  q: string | null
  solo_activos: boolean
}

export type BuscarProductosInput = AumentoFiltros & {
  page: number
  page_size: number
  sort: SortAumento
}

export type ProductoEnAumento = {
  id: string
  nombre: string
  sku_base: string | null
  marca_nombre: string | null
  categoria_nombre: string | null
  precio_neto: number
  stock_total: number
  activo: boolean
}

export type BuscarProductosResultado = {
  productos: ProductoEnAumento[]
  total: number
  /** Ignora paginación, para "seleccionar todos del filtro". Cap a 1000. */
  total_filtro_completo: number
}

function mapRow(r: Record<string, unknown>): ProductoEnAumento {
  return {
    id: r.id as string,
    nombre: r.nombre as string,
    sku_base: (r.sku_base as string | null) ?? null,
    marca_nombre: (r.marca_nombre as string | null) ?? null,
    categoria_nombre: (r.categoria_nombre as string | null) ?? null,
    precio_neto: Number(r.precio_neto ?? 0),
    stock_total: Number(r.stock_total ?? 0),
    activo: r.activo as boolean,
  }
}

/** ¿Hay al menos un filtro principal (marca o categoría) seteado? */
function tieneFiltroPrincipal(f: AumentoFiltros): boolean {
  return (
    (f.marca_id !== null && UUID_RE.test(f.marca_id)) ||
    (f.categoria_id !== null && UUID_RE.test(f.categoria_id))
  )
}

export async function buscarProductos(
  input: BuscarProductosInput
): Promise<BuscarProductosResultado> {
  const vacio: BuscarProductosResultado = {
    productos: [],
    total: 0,
    total_filtro_completo: 0,
  }
  try {
    const user = await getCurrentUser()
    if (!user || !puedeEditarCatalogo(user.rol) || !user.empresa_id) return vacio

    // Defensa en profundidad: al menos un filtro principal (la UI ya lo corta).
    if (!tieneFiltroPrincipal(input)) return vacio

    const pageSize = Math.min(
      Math.max(Number.isFinite(input.page_size) ? input.page_size : PAGE_SIZE_DEFAULT, 1),
      PAGE_SIZE_MAX
    )
    const page = Number.isFinite(input.page) && input.page >= 1 ? Math.floor(input.page) : 1
    const offset = (page - 1) * pageSize

    const supabase = await createClient()

    let q = supabase
      .from(VISTA)
      .select(COLS, { count: 'exact' })
      .eq('empresa_id', user.empresa_id)
    if (input.solo_activos) q = q.eq('activo', true)
    if (input.marca_id !== null) q = q.eq('marca_id', input.marca_id)
    if (input.categoria_id !== null) q = q.eq('categoria_id', input.categoria_id)
    if (input.q && input.q.trim()) {
      const term = escaparParaOrFilter(input.q.trim())
      if (term) q = q.or(`nombre.ilike.%${term}%,sku_base.ilike.%${term}%`)
    }

    switch (input.sort) {
      case 'precio_desc':
        q = q.order('precio_neto', { ascending: false })
        break
      case 'precio_asc':
        q = q.order('precio_neto', { ascending: true })
        break
      case 'nombre':
      default:
        q = q.order('nombre', { ascending: true })
        break
    }

    const { data, error, count } = await q.range(offset, offset + pageSize - 1)
    if (error) {
      console.error('[buscarProductos]', error.message)
      return vacio
    }

    const total = count ?? 0
    return {
      productos: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)),
      total,
      total_filtro_completo: Math.min(total, BULK_CAP),
    }
  } catch (error) {
    console.error('[buscarProductos] inesperado:', error)
    return vacio
  }
}

export type IdsDelFiltroResultado = {
  ids: string[]
  /** true si el filtro matchea más de 1000 (se cortó a 1000). */
  excede_cap: boolean
}

/**
 * Devuelve los ids del filtro completo (sin paginar), cap 1000, para el
 * "seleccionar todos" del banner. Mismos filtros que `buscarProductos`.
 */
export async function idsDelFiltro(
  filtros: AumentoFiltros
): Promise<IdsDelFiltroResultado> {
  try {
    const user = await getCurrentUser()
    if (!user || !puedeEditarCatalogo(user.rol) || !user.empresa_id) {
      return { ids: [], excede_cap: false }
    }
    if (!tieneFiltroPrincipal(filtros)) return { ids: [], excede_cap: false }

    const supabase = await createClient()
    let q = supabase
      .from(VISTA)
      .select('id', { count: 'exact' })
      .eq('empresa_id', user.empresa_id)
    if (filtros.solo_activos) q = q.eq('activo', true)
    if (filtros.marca_id !== null) q = q.eq('marca_id', filtros.marca_id)
    if (filtros.categoria_id !== null) q = q.eq('categoria_id', filtros.categoria_id)
    if (filtros.q && filtros.q.trim()) {
      const term = escaparParaOrFilter(filtros.q.trim())
      if (term) q = q.or(`nombre.ilike.%${term}%,sku_base.ilike.%${term}%`)
    }

    const { data, error, count } = await q.range(0, BULK_CAP - 1)
    if (error) {
      console.error('[idsDelFiltro]', error.message)
      return { ids: [], excede_cap: false }
    }

    return {
      ids: (data ?? []).map((r) => (r as { id: string }).id),
      excede_cap: (count ?? 0) > BULK_CAP,
    }
  } catch (error) {
    console.error('[idsDelFiltro] inesperado:', error)
    return { ids: [], excede_cap: false }
  }
}

/**
 * Trae los datos actuales de un set de ids (cap 1000) para calcular el preview
 * de precios. La selección puede abarcar varias páginas, así que el precio
 * actual de cada producto se relee fresco acá.
 */
export async function productosParaPreview(
  ids: string[]
): Promise<ProductoEnAumento[]> {
  try {
    const user = await getCurrentUser()
    if (!user || !puedeEditarCatalogo(user.rol) || !user.empresa_id) return []

    const limpios = [...new Set((ids ?? []).filter((id) => UUID_RE.test(id)))].slice(
      0,
      BULK_CAP
    )
    if (limpios.length === 0) return []

    const supabase = await createClient()
    const { data, error } = await supabase
      .from(VISTA)
      .select(COLS)
      .eq('empresa_id', user.empresa_id)
      .in('id', limpios)

    if (error) {
      console.error('[productosParaPreview]', error.message)
      return []
    }
    return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
  } catch (error) {
    console.error('[productosParaPreview] inesperado:', error)
    return []
  }
}
