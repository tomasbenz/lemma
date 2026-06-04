import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { escaparParaOrFilter } from './_helpers'
import type {
  Cliente,
  ClienteConStats,
  CondIva,
  ListarClientesOptions,
} from './clientes-types'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const SELECT_CON_STATS = `
  id,
  razon_social,
  cuit,
  cond_iva,
  email,
  telefono,
  domicilio,
  localidad,
  provincia,
  notas,
  activo,
  created_at,
  updated_at,
  ventas!ventas_cliente_id_fkey(id, total, estado)
`

function mapClienteConStats(c: {
  id: string
  razon_social: string
  cuit: string | null
  cond_iva: string
  email: string | null
  telefono: string | null
  domicilio: string | null
  localidad: string | null
  provincia: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
  ventas: unknown
}): ClienteConStats {
  const ventas = (c.ventas ?? []) as Array<{
    id: string
    total: number
    estado: string
  }>

  const ventasCerradas = ventas.filter((v) => v.estado === 'cerrada')
  const montoTotal = ventasCerradas.reduce((sum, v) => sum + v.total, 0)

  return {
    id: c.id,
    razon_social: c.razon_social,
    cuit: c.cuit,
    cond_iva: c.cond_iva as CondIva,
    email: c.email,
    telefono: c.telefono,
    domicilio: c.domicilio,
    localidad: c.localidad,
    provincia: c.provincia,
    notas: c.notas,
    activo: c.activo,
    created_at: c.created_at,
    updated_at: c.updated_at,
    cantidad_ventas: ventasCerradas.length,
    monto_total_vendido: montoTotal,
  }
}

/**
 * Rama fuzzy de listarClientes (q > 2 chars): la RPC buscar_clientes_ids
 * (pg_trgm + unaccent sobre razon_social) devuelve ids ordenados por
 * similaridad; CUIT y email se siguen buscando con ilike (substring exacto
 * tiene más sentido para esos campos) y van primero en el ranking.
 * El `orden` pedido se ignora: con búsqueda manda la relevancia (misma
 * convención que listarProductos). La paginación corre sobre la lista de
 * ids ya rankeada.
 */
async function listarClientesFuzzy(
  supabase: SupabaseServer,
  opts: { q: string; soloActivos: boolean; limit: number; offset: number }
): Promise<{ clientes: ClienteConStats[]; total: number }> {
  const { q, soloActivos, limit, offset } = opts
  const vacio = { clientes: [] as ClienteConStats[], total: 0 }

  const user = await getCurrentUser()
  if (!user?.empresa_id) return vacio

  // 1) ids fuzzy por razón social (la RPC deriva empresa_id de auth.uid()).
  const { data: fuzzyData, error: fuzzyError } = await supabase.rpc(
    'buscar_clientes_ids',
    { p_query: q }
  )
  if (fuzzyError) {
    console.error('[buscar_clientes_ids] Error:', fuzzyError.message)
  }
  const fuzzyIds = (fuzzyData ?? []).map((r) => r.cliente_id)

  // 2) ids por CUIT/email (substring, la RPC solo cubre razón social).
  const busq = escaparParaOrFilter(q)
  let exactIds: string[] = []
  if (busq) {
    const { data: exactData, error: exactError } = await supabase
      .from('clientes')
      .select('id')
      // Defense in depth: además de RLS, filtra por empresa explícitamente.
      .eq('empresa_id', user.empresa_id)
      .or(`cuit.ilike.%${busq}%,email.ilike.%${busq}%`)
    if (exactError) {
      console.error('[listarClientes] Error cuit/email:', exactError.message)
    }
    exactIds = (exactData ?? []).map((r) => r.id)
  }

  // 3) Merge sin duplicados: substring primero, fuzzy después.
  const vistos = new Set<string>()
  const ordenados: string[] = []
  for (const id of [...exactIds, ...fuzzyIds]) {
    if (!vistos.has(id)) {
      vistos.add(id)
      ordenados.push(id)
    }
  }
  if (ordenados.length === 0) return vacio

  // 4) Filtros restantes sobre los ids, preservando el orden por relevancia.
  let filtro = supabase
    .from('clientes')
    .select('id')
    .in('id', ordenados)
    // Defense in depth: además de RLS, filtra por empresa explícitamente.
    .eq('empresa_id', user.empresa_id)
  if (soloActivos) filtro = filtro.eq('activo', true)

  const { data: survData, error: survError } = await filtro
  if (survError) {
    console.error('[listarClientes] Error filtro fuzzy:', survError.message)
    throw new Error('Error al listar clientes')
  }

  const sobreviven = new Set((survData ?? []).map((r) => r.id))
  const idsFinal = ordenados.filter((id) => sobreviven.has(id))
  const total = idsFinal.length

  const pageIds = idsFinal.slice(offset, offset + limit)
  if (pageIds.length === 0) return { clientes: [], total }

  // 5) Filas completas + stats, reordenadas por relevancia.
  const { data: rows, error: rowsError } = await supabase
    .from('clientes')
    .select(SELECT_CON_STATS)
    .in('id', pageIds)
    .eq('empresa_id', user.empresa_id)
  if (rowsError) {
    console.error('[listarClientes] Error rows fuzzy:', rowsError.message)
    throw new Error('Error al listar clientes')
  }

  const porId = new Map((rows ?? []).map((r) => [r.id, r]))
  const clientes = pageIds
    .map((id) => porId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map(mapClienteConStats)

  return { clientes, total }
}

export async function listarClientes(options: ListarClientesOptions = {}) {
  const supabase = await createClient()

  const {
    q = '',
    soloActivos = true,
    orden = 'nombre_asc',
    limit = 100,
    offset = 0,
  } = options

  // ===== Rama con búsqueda fuzzy (q > 2 chars) =====
  // Queries de 1-2 chars siguen por ilike: substring es más predecible ahí
  // (mismo criterio que el fallback corto del helper cliente).
  if (q.trim().length > 2) {
    return listarClientesFuzzy(supabase, {
      q: q.trim(),
      soloActivos,
      limit,
      offset,
    })
  }

  // ===== Rama sin búsqueda (o query corta): ilike + orden + paginación =====
  let query = supabase
    .from('clientes')
    .select(SELECT_CON_STATS, { count: 'exact' })

  if (soloActivos) {
    query = query.eq('activo', true)
  }

  if (q.trim()) {
    const busq = escaparParaOrFilter(q)
    if (busq) {
      query = query.or(
        `razon_social.ilike.%${busq}%,cuit.ilike.%${busq}%,email.ilike.%${busq}%`
      )
    }
  }

  switch (orden) {
    case 'nombre_asc':
      query = query.order('razon_social', { ascending: true })
      break
    case 'nombre_desc':
      query = query.order('razon_social', { ascending: false })
      break
    case 'fecha_desc':
      query = query.order('created_at', { ascending: false })
      break
  }

  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('[listarClientes]', error)
    throw new Error('Error al listar clientes')
  }

  const clientes: ClienteConStats[] = (data ?? []).map(mapClienteConStats)

  return {
    clientes,
    total: count ?? 0,
  }
}

export async function obtenerCliente(id: string): Promise<Cliente | null> {
  // Defense in depth: además de RLS, filtra por empresa_id del usuario.
  // Sin empresa_id devolvemos null (mismo shape que "cliente no existe").
  const user = await getCurrentUser()
  if (!user?.empresa_id) return null

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select(
      `
      id,
      razon_social,
      cuit,
      cond_iva,
      email,
      telefono,
      domicilio,
      localidad,
      provincia,
      notas,
      activo,
      created_at,
      updated_at
    `
    )
    .eq('id', id)
    .eq('empresa_id', user.empresa_id)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    razon_social: data.razon_social,
    cuit: data.cuit,
    cond_iva: data.cond_iva as CondIva,
    email: data.email,
    telefono: data.telefono,
    domicilio: data.domicilio,
    localidad: data.localidad,
    provincia: data.provincia,
    notas: data.notas,
    activo: data.activo,
    created_at: data.created_at,
    updated_at: data.updated_at,
  }
}