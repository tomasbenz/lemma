import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type AuditEntry = {
  id: number
  usuario_id: string | null
  usuario_email: string
  entidad: string
  entidad_id: string | null
  accion: string
  detalle: Record<string, unknown> | null
  ip: string | null
  created_at: string
  es_accion_superadmin: boolean
  motivo_superadmin: string | null
}

export type FiltrosAuditoria = {
  entidad?: string
  accion?: string
  usuarioId?: string
  desde?: string // ISO
  hasta?: string
  limit?: number
  offset?: number
}

export async function listarAuditoria(
  filtros: FiltrosAuditoria = {}
): Promise<{ entries: AuditEntry[]; total: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (filtros.entidad) query = query.eq('entidad', filtros.entidad)
  if (filtros.accion) query = query.eq('accion', filtros.accion)
  if (filtros.usuarioId) query = query.eq('usuario_id', filtros.usuarioId)
  if (filtros.desde) query = query.gte('created_at', filtros.desde)
  if (filtros.hasta) query = query.lte('created_at', filtros.hasta)

  const limit = filtros.limit ?? 50
  const offset = filtros.offset ?? 0
  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error || !data) {
    console.error('[listarAuditoria]', error)
    return { entries: [], total: 0 }
  }

  const entries: AuditEntry[] = data.map((d) => ({
    id: typeof d.id === 'number' ? d.id : Number(d.id),
    usuario_id: d.usuario_id,
    usuario_email: d.usuario_email_snapshot ?? 'desconocido',
    entidad: d.entidad,
    entidad_id: d.entidad_id,
    accion: d.accion,
    detalle: (d.detalle as Record<string, unknown>) ?? null,
    ip: d.ip ? String(d.ip) : null,
    created_at: d.created_at,
    es_accion_superadmin: d.es_accion_superadmin ?? false,
    motivo_superadmin: d.motivo_superadmin,
  }))

  return { entries, total: count ?? 0 }
}

/**
 * Devuelve listas de valores únicos para los selects de filtros.
 */
export async function obtenerFacetasAuditoria(): Promise<{
  entidades: string[]
  acciones: string[]
}> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('audit_log')
    .select('entidad, accion')
    .limit(2000)

  if (!data) return { entidades: [], acciones: [] }

  const entidades = Array.from(new Set(data.map((d) => d.entidad))).sort()
  const acciones = Array.from(new Set(data.map((d) => d.accion))).sort()

  return { entidades, acciones }
}