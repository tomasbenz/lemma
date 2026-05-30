import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import type { Json } from '@/types/database'

export type OperacionOmitido = {
  id?: string
  sku_variante?: string
  motivo: string
}

export type Operacion = {
  id: string
  usuario_email_snapshot: string
  accion: string
  parametros: Json
  total_solicitados: number
  afectados: number
  cantidad_omitidos: number
  omitidos: OperacionOmitido[]
  ids_afectados: string[]
  creado_at: string
}

export type ListarOperacionesOptions = {
  acciones?: string[]
  desde?: string // ISO
  hasta?: string
  soloConOmitidos?: boolean
  page?: number
  perPage?: number
}

function aOperacion(d: Record<string, unknown>): Operacion {
  return {
    id: d.id as string,
    usuario_email_snapshot: (d.usuario_email_snapshot as string) ?? 'desconocido',
    accion: d.accion as string,
    parametros: (d.parametros as Json) ?? {},
    total_solicitados: Number(d.total_solicitados ?? 0),
    afectados: Number(d.afectados ?? 0),
    cantidad_omitidos: Number(d.cantidad_omitidos ?? 0),
    omitidos: (d.omitidos as OperacionOmitido[]) ?? [],
    ids_afectados: (d.ids_afectados as string[]) ?? [],
    creado_at: d.creado_at as string,
  }
}

export async function listarOperaciones(
  options: ListarOperacionesOptions = {}
): Promise<{ operaciones: Operacion[]; total: number }> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { operaciones: [], total: 0 }

  const supabase = await createClient()

  let query = supabase
    .from('operaciones_masivas')
    .select('*', { count: 'exact' })
    .eq('empresa_id', user.empresa_id)
    .order('creado_at', { ascending: false })

  if (options.acciones && options.acciones.length > 0) {
    query = query.in('accion', options.acciones)
  }
  if (options.desde) query = query.gte('creado_at', options.desde)
  if (options.hasta) query = query.lte('creado_at', options.hasta)
  if (options.soloConOmitidos) query = query.gt('cantidad_omitidos', 0)

  const perPage = options.perPage ?? 50
  const page = Math.max(1, options.page ?? 1)
  const offset = (page - 1) * perPage
  query = query.range(offset, offset + perPage - 1)

  const { data, error, count } = await query
  if (error || !data) {
    console.error('[listarOperaciones]', error?.message)
    return { operaciones: [], total: 0 }
  }

  return { operaciones: data.map(aOperacion), total: count ?? 0 }
}

export async function obtenerOperacion(id: string): Promise<Operacion | null> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('operaciones_masivas')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', user.empresa_id)
    .maybeSingle()

  if (error || !data) return null
  return aOperacion(data)
}

export async function obtenerFacetasOperaciones(): Promise<{ acciones: string[] }> {
  const user = await getCurrentUser()
  if (!user?.empresa_id) return { acciones: [] }

  const supabase = await createClient()
  const { data } = await supabase
    .from('operaciones_masivas')
    .select('accion')
    .eq('empresa_id', user.empresa_id)
    .limit(2000)

  if (!data) return { acciones: [] }
  return { acciones: Array.from(new Set(data.map((d) => d.accion))).sort() }
}

export type ProductoResuelto = { id: string; nombre: string; sku_base: string }

/**
 * Hidrata una lista de ids de producto con nombre + sku_base (para el detalle).
 * Cap 1000. Filtra por empresa_id (defense in depth).
 */
export async function resolverProductosPorIds(
  ids: string[]
): Promise<ProductoResuelto[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const user = await getCurrentUser()
  if (!user?.empresa_id) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, sku_base')
    .in('id', ids.slice(0, 1000))
    .eq('empresa_id', user.empresa_id)

  if (error || !data) return []
  return data.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    sku_base: p.sku_base,
  }))
}
