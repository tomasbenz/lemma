import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type ProductoConVariantes = Database['public']['Tables']['productos']['Row'] & {
  variantes: Database['public']['Tables']['variantes']['Row'][]
  stock_total: number
}

export type ListarProductosOptions = {
  busqueda?: string
  soloActivos?: boolean
  stockBajo?: boolean
  categoria?: string
  orden?: 'nombre_asc' | 'nombre_desc' | 'fecha_desc' | 'stock_asc' | 'stock_desc'
  limit?: number
  offset?: number
}

/**
 * Escapa caracteres que romperían un string en un filtro .or() de Supabase.
 * Reemplaza caracteres peligrosos con su equivalente encoded o los elimina.
 */
function escaparParaOrFilter(valor: string): string {
  // Supabase usa comas como separador dentro de .or() y paréntesis como delimitadores.
  // También escapamos asterisco y %, que son wildcards de ilike.
  return valor
    .replace(/[,()]/g, ' ') // eliminar separadores peligrosos
    .replace(/\*/g, '') // eliminar wildcards
    .replace(/%/g, '') // eliminar wildcards
    .trim()
}

/**
 * Lista productos con sus variantes agregadas.
 *
 * Filtros, búsqueda, orden y stock bajo se aplican en la DB vía función
 * agregada cuando es posible, para evitar traer data innecesaria a Node.
 */
export async function listarProductos(options: ListarProductosOptions = {}) {
  const supabase = await createClient()

  const {
    busqueda = '',
    soloActivos = true,
    stockBajo = false,
    categoria = '',
    orden = 'nombre_asc',
    limit = 50,
    offset = 0,
  } = options

  const busquedaSanitizada = escaparParaOrFilter(busqueda)

  // 1. Obtener IDs y stocks agregados desde la DB con una query
  let aggQuery = supabase
    .from('productos_con_stock_total')
    .select('*', { count: 'exact' })

  if (soloActivos) aggQuery = aggQuery.eq('activo', true)

  if (stockBajo) aggQuery = aggQuery.eq('tiene_stock_bajo', true)

  if (categoria) {
    aggQuery = aggQuery.eq('categoria', categoria)
  }

  if (busquedaSanitizada) {
    aggQuery = aggQuery.or(
      `nombre.ilike.%${busquedaSanitizada}%,sku_base.ilike.%${busquedaSanitizada}%`
    )
  }

  // Orden
  switch (orden) {
    case 'nombre_asc':
      aggQuery = aggQuery.order('nombre', { ascending: true })
      break
    case 'nombre_desc':
      aggQuery = aggQuery.order('nombre', { ascending: false })
      break
    case 'fecha_desc':
      aggQuery = aggQuery.order('created_at', { ascending: false })
      break
    case 'stock_asc':
      aggQuery = aggQuery.order('stock_total', { ascending: true })
      break
    case 'stock_desc':
      aggQuery = aggQuery.order('stock_total', { ascending: false })
      break
  }

  aggQuery = aggQuery.range(offset, offset + limit - 1)

  const { data: aggData, error: aggError, count } = await aggQuery

  if (aggError) {
    console.error('[listarProductos] Error agg:', aggError.message)
    throw new Error('Error al listar productos')
  }

  if (!aggData || aggData.length === 0) {
    return { productos: [], total: count ?? 0 }
  }

  // 2. Traer variantes solo de los productos visibles (página actual)
  const ids = aggData.map((p) => p.id as string)
  const { data: variantesData, error: varError } = await supabase
    .from('variantes')
    .select('*')
    .in('producto_id', ids)

  if (varError) {
    console.error('[listarProductos] Error variantes:', varError.message)
    throw new Error('Error al cargar variantes')
  }

  const variantesPorProducto = new Map<
    string,
    Database['public']['Tables']['variantes']['Row'][]
  >()
  for (const v of variantesData ?? []) {
    const arr = variantesPorProducto.get(v.producto_id) ?? []
    arr.push(v)
    variantesPorProducto.set(v.producto_id, arr)
  }

  // 3. Armar respuesta respetando el orden ya aplicado
  const productos: ProductoConVariantes[] = aggData.map((p) => {
    const variantes = variantesPorProducto.get(p.id as string) ?? []
    return {
      id: p.id as string,
      nombre: p.nombre as string,
      sku_base: p.sku_base as string,
      precio_neto: p.precio_neto as number,
      categoria: p.categoria as string | null,
      imagen_url: p.imagen_url as string | null,
      track_stock: p.track_stock as boolean,
      activo: p.activo as boolean,
      descripcion_corta: p.descripcion_corta as string | null,
      created_at: p.created_at as string,
      variantes,
      stock_total: Number(p.stock_total ?? 0),
    } as ProductoConVariantes
  })

  return {
    productos,
    total: count ?? 0,
  }
}

/**
 * Obtiene un producto por ID con TODAS sus variantes (activas e inactivas).
 */
export async function obtenerProducto(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('productos')
    .select(`*, variantes(*)`)
    .eq('id', id)
    .single()

  if (error) {
    console.error('[obtenerProducto] Error:', error.message)
    return null
  }

  if (!data) return null

  // Orden determinístico: primero activas, después por sku_variante (que
  // se deriva de los atributos alfabéticamente vía sufijoSku()).
  const variantesOrdenadas = [...(data.variantes ?? [])].sort((a, b) => {
    if (a.activa !== b.activa) return a.activa ? -1 : 1
    const skuA = (a.sku_variante ?? '').toLowerCase()
    const skuB = (b.sku_variante ?? '').toLowerCase()
    return skuA.localeCompare(skuB)
  })

  return {
    ...data,
    variantes: variantesOrdenadas,
  }
}

/**
 * Verifica si un SKU base ya existe.
 */
export async function existeSkuBase(
  sku: string,
  excluirId?: string
): Promise<boolean> {
  const supabase = await createClient()

  let query = supabase
    .from('productos')
    .select('id')
    .eq('sku_base', sku)
    .limit(1)

  if (excluirId) {
    query = query.neq('id', excluirId)
  }

  const { data } = await query
  return (data?.length ?? 0) > 0
}

/**
 * Lista categorías únicas existentes en la empresa actual (no nulas, no vacías).
 * Ordenadas alfabéticamente, case-insensitive.
 */
export async function listarCategorias(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('productos')
    .select('categoria')
    .not('categoria', 'is', null)
    .neq('categoria', '')

  if (error) {
    console.error('[listarCategorias] Error:', error.message)
    return []
  }

  const unicas = Array.from(
    new Set((data ?? []).map((p) => p.categoria as string))
  ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))

  return unicas
}