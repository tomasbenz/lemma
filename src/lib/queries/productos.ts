import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import type { Database } from '@/types/database'
import { formatAtributos } from '@/lib/format-atributos'
import { inLotes } from './_helpers'

export type ProductoConVariantes = Database['public']['Tables']['productos']['Row'] & {
  variantes: Database['public']['Tables']['variantes']['Row'][]
  stock_total: number
  /** Nombre de la marca (vía JOIN en la vista). null si sin marca. */
  marca_nombre: string | null
  /** Nombre de la categoría real (vía JOIN en la vista). null si sin categoría. */
  categoria_nombre: string | null
}

/** Opción simple {id, nombre} para selects/filtros de marca o categoría. */
export type OpcionCatalogo = { id: string; nombre: string }

export type ListarProductosOptions = {
  busqueda?: string
  soloActivos?: boolean
  stockBajo?: boolean
  /** Filtro por marca (FK productos.marca_id). */
  marcaId?: string
  /** Filtro por categoría real (FK productos.categoria_id). */
  categoriaId?: string
  /**
   * Filtro por estado de categorización:
   *  - 'sin' → solo productos con categoria_id NULL (falta categorizar)
   *  - 'con' → solo productos con categoría asignada
   *  - undefined/'' → todos
   */
  categoriaAsignada?: 'sin' | 'con'
  orden?: 'nombre_asc' | 'nombre_desc' | 'fecha_desc' | 'stock_asc' | 'stock_desc'
  limit?: number
  offset?: number
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * Búsqueda fuzzy de productos vía RPC (pg_trgm + unaccent). Devuelve los ids
 * ordenados por similaridad descendente. PostgREST no expone el operador `%`,
 * por eso la búsqueda fuzzy va por RPC y no inline.
 *
 * - `null` → no hay búsqueda (el caller usa su filtrado normal sin texto).
 * - `[]`   → hay búsqueda pero sin coincidencias.
 */
async function obtenerIdsBusquedaFuzzy(
  supabase: SupabaseServer,
  busqueda: string
): Promise<string[] | null> {
  const q = busqueda.trim()
  if (!q) return null

  // La RPC deriva empresa_id de auth.uid() (no se pasa desde el cliente).
  const { data, error } = await supabase.rpc('buscar_productos_ids', {
    p_query: q,
  })

  if (error) {
    console.error('[buscar_productos_ids] Error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return []
  }

  // La RPC ya devuelve ids ordenados por similaridad DESC.
  return (data ?? []).map((r) => r.producto_id as string)
}

/**
 * Trae las variantes de un set de filas agregadas y arma ProductoConVariantes[],
 * respetando el orden de `aggData`. Compartido por la rama con y sin búsqueda.
 */
async function hidratarConVariantes(
  supabase: SupabaseServer,
  aggData: Record<string, unknown>[]
): Promise<ProductoConVariantes[]> {
  if (aggData.length === 0) return []

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

  return aggData.map((p) => {
    const variantes = variantesPorProducto.get(p.id as string) ?? []
    return {
      id: p.id as string,
      nombre: p.nombre as string,
      sku_base: p.sku_base as string,
      precio_neto: p.precio_neto as number,
      marca_id: (p.marca_id as string | null) ?? null,
      marca_nombre: (p.marca_nombre as string | null) ?? null,
      categoria_id: (p.categoria_id as string | null) ?? null,
      categoria_nombre: (p.categoria_nombre as string | null) ?? null,
      imagen_url: p.imagen_url as string | null,
      track_stock: p.track_stock as boolean,
      activo: p.activo as boolean,
      descripcion_corta: p.descripcion_corta as string | null,
      created_at: p.created_at as string,
      variantes,
      stock_total: Number(p.stock_total ?? 0),
    } as ProductoConVariantes
  })
}

/**
 * Lista productos con sus variantes agregadas.
 *
 * Filtros, orden y stock bajo se aplican en la DB. La búsqueda por texto usa
 * fuzzy (pg_trgm) vía RPC: cuando hay búsqueda, los resultados se ordenan por
 * similaridad descendente (ignorando el `orden` pedido) y se paginan sobre la
 * lista de ids ya rankeada.
 */
export async function listarProductos(options: ListarProductosOptions = {}) {
  const supabase = await createClient()

  const {
    busqueda = '',
    soloActivos = true,
    stockBajo = false,
    marcaId = '',
    categoriaId = '',
    categoriaAsignada,
    orden = 'nombre_asc',
    limit = 50,
    offset = 0,
  } = options

  // ===== Rama con búsqueda: fuzzy por RPC, ordenado por similaridad =====
  if (busqueda.trim()) {
    const user = await getCurrentUser()
    if (!user?.empresa_id) return { productos: [], total: 0 }
    // Capturado para que el narrowing sobreviva dentro del callback de inLotes.
    const empresaId = user.empresa_id

    const rankedIds = await obtenerIdsBusquedaFuzzy(supabase, busqueda)
    if (!rankedIds || rankedIds.length === 0) {
      return { productos: [], total: 0 }
    }

    // Aplicar el resto de filtros sobre los ids fuzzy, preservando el orden
    // de similaridad (la vista no expone `sim`, así que reordenamos en JS).
    // rankedIds puede traer hasta 1000 ids: .in() con >~390 UUIDs supera el
    // límite de ~16KB de URL de PostgREST (400 Bad Request) → va en lotes.
    const { data: survData, error: survError } = await inLotes(
      rankedIds,
      (chunk) => {
        let filtroQuery = supabase
          .from('productos_con_stock_total')
          .select('id')
          .in('id', chunk)
          // Defense in depth: además de RLS, filtra por empresa explícitamente.
          .eq('empresa_id', empresaId)
        if (soloActivos) filtroQuery = filtroQuery.eq('activo', true)
        if (stockBajo) filtroQuery = filtroQuery.eq('tiene_stock_bajo', true)
        if (marcaId) filtroQuery = filtroQuery.eq('marca_id', marcaId)
        if (categoriaId) filtroQuery = filtroQuery.eq('categoria_id', categoriaId)
        if (categoriaAsignada === 'sin') filtroQuery = filtroQuery.is('categoria_id', null)
        else if (categoriaAsignada === 'con') filtroQuery = filtroQuery.not('categoria_id', 'is', null)
        return filtroQuery
      }
    )
    if (survError) {
      console.error('[listarProductos] Error filtro fuzzy:', {
        message: survError.message,
        code: survError.code,
        details: survError.details,
        hint: survError.hint,
        idsCount: rankedIds.length,
      })
      throw new Error('Error al listar productos')
    }

    const sobreviven = new Set((survData ?? []).map((r) => r.id as string))
    const ordenados = rankedIds.filter((id) => sobreviven.has(id))
    const total = ordenados.length

    const pageIds = ordenados.slice(offset, offset + limit)
    if (pageIds.length === 0) return { productos: [], total }

    const { data: rows, error: rowsError } = await supabase
      .from('productos_con_stock_total')
      .select('*')
      .in('id', pageIds)
      .eq('empresa_id', user.empresa_id)
    if (rowsError) {
      console.error('[listarProductos] Error rows fuzzy:', {
        message: rowsError.message,
        code: rowsError.code,
        details: rowsError.details,
        hint: rowsError.hint,
        idsCount: pageIds.length,
      })
      throw new Error('Error al listar productos')
    }

    const porId = new Map((rows ?? []).map((r) => [r.id as string, r]))
    const aggData = pageIds
      .map((id) => porId.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null)

    const productos = await hidratarConVariantes(supabase, aggData)
    return { productos, total }
  }

  // ===== Rama sin búsqueda: filtros + orden + paginación en la vista =====
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { productos: [], total: 0 }

  let aggQuery = supabase
    .from('productos_con_stock_total')
    .select('*', { count: 'exact' })
    // Defense in depth: además de RLS, filtra por empresa explícitamente.
    .eq('empresa_id', user.empresa_id)

  if (soloActivos) aggQuery = aggQuery.eq('activo', true)

  if (stockBajo) aggQuery = aggQuery.eq('tiene_stock_bajo', true)

  if (marcaId) aggQuery = aggQuery.eq('marca_id', marcaId)
  if (categoriaId) aggQuery = aggQuery.eq('categoria_id', categoriaId)
  if (categoriaAsignada === 'sin') aggQuery = aggQuery.is('categoria_id', null)
  else if (categoriaAsignada === 'con') aggQuery = aggQuery.not('categoria_id', 'is', null)

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

  const productos = await hidratarConVariantes(supabase, aggData)

  return {
    productos,
    total: count ?? 0,
  }
}

export type ListarProductoIdsResult = {
  ids: string[]
  /**
   * true si el filtro matchea MÁS de 1000 productos. En ese caso `ids` viene
   * truncado a los primeros 1000 y el UI debe avisar al usuario que solo se
   * seleccionaron esos (las acciones masivas cortan a 1000 por operación).
   */
  excedeCap: boolean
}

const BULK_CAP = 1000

/**
 * Devuelve SOLO los ids de los productos que matchean un filtro, sin variantes
 * ni metadata. Pensada para el "seleccionar todos los del filtro" de las
 * acciones masivas: permite obtener los ids de los ~6000 productos de un filtro
 * sin traer las filas completas al cliente.
 *
 * Reusa la vista `productos_con_stock_total` y aplica EXACTAMENTE los mismos
 * filtros que `listarProductos` (sin orden/limit/offset), así "seleccionar
 * todos" coincide fila por fila con lo que muestra el listado.
 *
 * Cap de seguridad: si el filtro matchea más de 1000 productos, corta en 1000
 * y devuelve `excedeCap: true` (las RPCs de bulk rechazan > 1000 igual).
 */
export async function listarProductoIdsPorFiltro(
  options: Pick<
    ListarProductosOptions,
    | 'busqueda'
    | 'soloActivos'
    | 'stockBajo'
    | 'marcaId'
    | 'categoriaId'
    | 'categoriaAsignada'
  > = {}
): Promise<ListarProductoIdsResult> {
  const supabase = await createClient()

  const {
    busqueda = '',
    soloActivos = true,
    stockBajo = false,
    marcaId = '',
    categoriaId = '',
    categoriaAsignada,
  } = options

  // ===== Rama con búsqueda: fuzzy por RPC =====
  if (busqueda.trim()) {
    const user = await getCurrentUser()
    if (!user?.empresa_id) return { ids: [], excedeCap: false }
    // Capturado para que el narrowing sobreviva dentro del callback de inLotes.
    const empresaId = user.empresa_id

    const rankedIds = await obtenerIdsBusquedaFuzzy(supabase, busqueda)
    if (!rankedIds || rankedIds.length === 0) {
      return { ids: [], excedeCap: false }
    }

    // rankedIds puede traer hasta 1000 ids → .in() en lotes (límite de URL).
    const { data, error } = await inLotes(rankedIds, (chunk) => {
      let q = supabase
        .from('productos_con_stock_total')
        .select('id')
        .in('id', chunk)
        // Defense in depth: además de RLS, filtra por empresa explícitamente.
        .eq('empresa_id', empresaId)
      if (soloActivos) q = q.eq('activo', true)
      if (stockBajo) q = q.eq('tiene_stock_bajo', true)
      if (marcaId) q = q.eq('marca_id', marcaId)
      if (categoriaId) q = q.eq('categoria_id', categoriaId)
      if (categoriaAsignada === 'sin') q = q.is('categoria_id', null)
      else if (categoriaAsignada === 'con') q = q.not('categoria_id', 'is', null)
      return q
    })
    if (error) {
      console.error('[listarProductoIdsPorFiltro] Error fuzzy:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        idsCount: rankedIds.length,
      })
      throw new Error('Error al listar ids de productos')
    }

    const sobreviven = new Set((data ?? []).map((r) => r.id as string))
    const ordenados = rankedIds.filter((id) => sobreviven.has(id))
    const excedeCap = ordenados.length > BULK_CAP

    return {
      ids: excedeCap ? ordenados.slice(0, BULK_CAP) : ordenados,
      excedeCap,
    }
  }

  // ===== Rama sin búsqueda =====
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { ids: [], excedeCap: false }

  let query = supabase
    .from('productos_con_stock_total')
    .select('id')
    // Defense in depth: además de RLS, filtra por empresa explícitamente.
    .eq('empresa_id', user.empresa_id)

  if (soloActivos) query = query.eq('activo', true)
  if (stockBajo) query = query.eq('tiene_stock_bajo', true)
  if (marcaId) query = query.eq('marca_id', marcaId)
  if (categoriaId) query = query.eq('categoria_id', categoriaId)
  if (categoriaAsignada === 'sin') query = query.is('categoria_id', null)
  else if (categoriaAsignada === 'con') query = query.not('categoria_id', 'is', null)

  // Traemos 1001 para detectar el exceso de cap sin un count aparte.
  query = query.limit(BULK_CAP + 1)

  const { data, error } = await query

  if (error) {
    console.error('[listarProductoIdsPorFiltro] Error:', error.message)
    throw new Error('Error al listar ids de productos')
  }

  const todos = (data ?? []).map((p) => p.id as string)
  const excedeCap = todos.length > BULK_CAP

  return {
    ids: excedeCap ? todos.slice(0, BULK_CAP) : todos,
    excedeCap,
  }
}

export type ProductoPreview = {
  id: string
  nombre: string
  precio_neto: number
  track_stock: boolean
  variantes: { id: string; stock: number; activa: boolean; sku_variante: string }[]
}

/**
 * Trae el shape liviano necesario para la preview editable de acciones masivas
 * (Fase 2): valor actual de precio y stock por variante. A diferencia de
 * `listarProductos`, busca por una lista explícita de ids (la selección puede
 * incluir ids de páginas que el listado no cargó).
 *
 * Defense in depth: filtra por empresa_id del usuario autenticado además de RLS.
 */
export async function obtenerProductosParaPreview(
  ids: string[]
): Promise<ProductoPreview[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  if (ids.length > BULK_CAP) {
    throw new Error('Demasiados productos para previsualizar (máx. 1000)')
  }

  const user = await getCurrentUser()
  if (!user?.empresa_id) return []
  // Capturado para que el narrowing sobreviva dentro del callback de inLotes.
  const empresaId = user.empresa_id

  const supabase = await createClient()
  // ids puede traer hasta 1000 → .in() en lotes (límite de ~16KB de URL).
  const { data, error } = await inLotes(ids, (chunk) =>
    supabase
      .from('productos')
      .select('id, nombre, precio_neto, track_stock, variantes(id, stock, activa, sku_variante)')
      .in('id', chunk)
      .eq('empresa_id', empresaId)
  )

  if (error) {
    console.error('[obtenerProductosParaPreview] Error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      idsCount: ids.length,
    })
    throw new Error('Error al cargar productos para la vista previa')
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precio_neto: p.precio_neto,
    track_stock: p.track_stock,
    variantes: (p.variantes ?? []).map((v) => ({
      id: v.id,
      stock: v.stock,
      activa: v.activa,
      sku_variante: v.sku_variante ?? '',
    })),
  }))
}

export type ProductoFilaExport = {
  sku_base: string
  sku_variante: string
  nombre: string
  atributos: string
  /** Nombre de la marca (productos.marca_id → marcas.nombre). */
  marca: string | null
  /** Nombre de la categoría real (productos.categoria_id → catalogo_categorias.nombre). */
  categoria: string | null
  precio_neto: number
  stock: number
  activo_producto: boolean
  activa_variante: boolean
  codigo_barras: string | null
}

/**
 * Aplana el catálogo a UNA fila por variante para exportar a Excel (Fase 3).
 * Aplica los mismos filtros que `listarProductos` (sin paginación) y trae TODAS
 * las variantes (activas e inactivas), para que el round-trip export → editar →
 * import pueda reactivar/ajustar cualquier variante.
 *
 * Defense in depth: filtra por empresa_id además de RLS.
 */
export async function exportarProductosFilas(
  options: ListarProductosOptions = {}
): Promise<ProductoFilaExport[]> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return []
  // Capturado para que el narrowing sobreviva dentro del callback de inLotes.
  const empresaId = user.empresa_id

  const supabase = await createClient()

  const {
    busqueda = '',
    soloActivos = true,
    stockBajo = false,
    marcaId = '',
    categoriaId = '',
    categoriaAsignada,
  } = options

  // Búsqueda fuzzy (si hay): restringe a los ids que matchean. El export se
  // ordena por nombre (es una planilla); no necesita orden por similaridad.
  let rankedIds: string[] | null = null
  if (busqueda.trim()) {
    rankedIds = await obtenerIdsBusquedaFuzzy(supabase, busqueda)
    if (!rankedIds || rankedIds.length === 0) return []
  }

  const armarQueryProductos = (chunkIds: string[] | null) => {
    let agg = supabase
      .from('productos_con_stock_total')
      .select('id, sku_base, nombre, marca_nombre, categoria_nombre, precio_neto, track_stock, activo')
      .eq('empresa_id', empresaId)

    if (soloActivos) agg = agg.eq('activo', true)
    if (stockBajo) agg = agg.eq('tiene_stock_bajo', true)
    if (marcaId) agg = agg.eq('marca_id', marcaId)
    if (categoriaId) agg = agg.eq('categoria_id', categoriaId)
    if (categoriaAsignada === 'sin') agg = agg.is('categoria_id', null)
    else if (categoriaAsignada === 'con') agg = agg.not('categoria_id', 'is', null)
    if (chunkIds) agg = agg.in('id', chunkIds)

    return agg.order('nombre', { ascending: true })
  }

  // Con búsqueda, rankedIds puede traer hasta 1000 ids → .in() en lotes
  // (límite de ~16KB de URL). Cada lote vuelve ordenado, pero el merge no:
  // se re-ordena por nombre en JS (el export es una planilla por nombre).
  const { data: prods, error: errProds } = rankedIds
    ? await inLotes(rankedIds, (chunk) => armarQueryProductos(chunk))
    : await armarQueryProductos(null)
  if (errProds) {
    console.error('[exportarProductosFilas] Error productos:', {
      message: errProds.message,
      code: errProds.code,
      details: errProds.details,
      hint: errProds.hint,
      idsCount: rankedIds?.length ?? null,
    })
    throw new Error('Error al exportar productos')
  }
  if (!prods || prods.length === 0) return []
  if (rankedIds) {
    prods.sort((a, b) =>
      (a.nombre as string).localeCompare(b.nombre as string)
    )
  }

  // ids = TODOS los productos del filtro (sin búsqueda puede ser el catálogo
  // entero, ~6600 en Samu) → .in() en lotes obligatorio.
  const ids = prods.map((p) => p.id as string)
  const { data: variantes, error: errVar } = await inLotes(ids, (chunk) =>
    supabase
      .from('variantes')
      .select('producto_id, sku_variante, atributos, stock, activa, codigo_barras')
      .in('producto_id', chunk)
      .eq('empresa_id', empresaId)
  )

  if (errVar) {
    console.error('[exportarProductosFilas] Error variantes:', {
      message: errVar.message,
      code: errVar.code,
      details: errVar.details,
      hint: errVar.hint,
      idsCount: ids.length,
    })
    throw new Error('Error al exportar variantes')
  }

  const variantesPorProducto = new Map<string, typeof variantes>()
  for (const v of variantes ?? []) {
    const arr = variantesPorProducto.get(v.producto_id) ?? []
    arr.push(v)
    variantesPorProducto.set(v.producto_id, arr)
  }

  const filas: ProductoFilaExport[] = []
  for (const p of prods) {
    const vars = [...(variantesPorProducto.get(p.id as string) ?? [])].sort(
      (a, b) => (a.sku_variante ?? '').localeCompare(b.sku_variante ?? '')
    )
    for (const v of vars) {
      filas.push({
        sku_base: p.sku_base as string,
        sku_variante: v.sku_variante ?? '',
        nombre: p.nombre as string,
        atributos: formatAtributos(v.atributos),
        marca: (p.marca_nombre as string | null) ?? null,
        categoria: (p.categoria_nombre as string | null) ?? null,
        precio_neto: p.precio_neto as number,
        stock: v.stock,
        activo_producto: p.activo as boolean,
        activa_variante: v.activa,
        codigo_barras: v.codigo_barras ?? null,
      })
    }
  }

  return filas
}

/**
 * Obtiene un producto por ID con TODAS sus variantes (activas e inactivas).
 *
 * Defense in depth: además de RLS, filtra por empresa_id del usuario autenticado.
 * Si el usuario no tiene empresa_id (sesión rota o sin tenant), devuelve null
 * con el mismo shape que "producto no existe" para no filtrar información.
 */
export async function obtenerProducto(id: string) {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return null

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('productos')
    .select(`*, variantes(*), marca:marcas(nombre), categoria:catalogo_categorias(nombre)`)
    .eq('id', id)
    .eq('empresa_id', user.empresa_id)
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

  // Embeds to-one: supabase puede tiparlos como objeto o como array de 1.
  const nombreEmbed = (raw: unknown): string | null => {
    const obj = Array.isArray(raw) ? raw[0] ?? null : raw
    return obj && typeof obj === 'object' && 'nombre' in obj
      ? ((obj as { nombre: string }).nombre ?? null)
      : null
  }

  return {
    ...data,
    variantes: variantesOrdenadas,
    marca_nombre: nombreEmbed((data as { marca?: unknown }).marca),
    categoria_nombre: nombreEmbed((data as { categoria?: unknown }).categoria),
  }
}

/**
 * Verifica si un SKU base ya existe.
 */
export async function existeSkuBase(
  sku: string,
  excluirId?: string
): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return false

  const supabase = await createClient()

  let query = supabase
    .from('productos')
    .select('id')
    // Defense in depth sobre RLS: scopea por empresa.
    .eq('empresa_id', user.empresa_id)
    .eq('sku_base', sku)
    .limit(1)

  if (excluirId) {
    query = query.neq('id', excluirId)
  }

  const { data } = await query
  return (data?.length ?? 0) > 0
}

/**
 * Lista las marcas activas de la empresa actual (id + nombre), ordenadas
 * alfabéticamente. Fuente del dropdown de filtro "Marca" y del select del form.
 * (RLS limita a la empresa del usuario.)
 */
export async function listarMarcas(): Promise<OpcionCatalogo[]> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marcas')
    .select('id, nombre')
    // Defense in depth sobre RLS: scopea por empresa.
    .eq('empresa_id', user.empresa_id)
    .eq('activo', true)
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarMarcas] Error:', error.message)
    return []
  }

  return (data ?? []).map((m) => ({ id: m.id as string, nombre: m.nombre as string }))
}

/**
 * Lista las categorías REALES activas (catalogo_categorias) de la empresa
 * actual (id + nombre). Fuente del dropdown de filtro "Categoría" del listado.
 * Para el form de producto ya existe `listarCategorias()` en queries/catalogos.
 */
export async function listarCategoriasReales(): Promise<OpcionCatalogo[]> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('catalogo_categorias')
    .select('id, nombre')
    // Defense in depth sobre RLS: scopea por empresa.
    .eq('empresa_id', user.empresa_id)
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (error) {
    console.error('[listarCategoriasReales] Error:', error.message)
    return []
  }

  return (data ?? []).map((c) => ({ id: c.id as string, nombre: c.nombre as string }))
}