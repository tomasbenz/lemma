// src/lib/queries/historial-venta.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type HistorialEvento = {
  id: number
  created_at: string
  accion: string
  usuario_email: string | null
  detalle: Record<string, unknown> | null
  ip: string | null
}

/**
 * Lista todos los eventos de audit_log asociados a una venta/pedido.
 * Filtra entidad='venta' + entidad_id=ventaId + empresa_id.
 * En orden descendente por created_at (mas reciente primero).
 *
 * No crashea: si hay error o nada, devuelve [].
 */
export async function listarHistorialVenta(
  ventaId: string,
  empresaId: string
): Promise<HistorialEvento[]> {
  if (!ventaId || !empresaId) return []

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, created_at, accion, usuario_email_snapshot, detalle, ip')
    .eq('entidad', 'venta')
    .eq('entidad_id', ventaId)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[listarHistorialVenta] Error:', error.message)
    return []
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    accion: r.accion,
    usuario_email: r.usuario_email_snapshot,
    detalle:
      r.detalle && typeof r.detalle === 'object' && !Array.isArray(r.detalle)
        ? (r.detalle as Record<string, unknown>)
        : null,
    ip: r.ip === null || r.ip === undefined ? null : String(r.ip),
  }))
}
