import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Refresca el stock actual de un conjunto de variantes.
 * Usado antes de cobrar para validar contra stock real en DB.
 */
export async function refrescarStocksVariantes(
  ids: string[]
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  if (ids.length === 0) return mapa

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('variantes')
    .select('id, stock, activa')
    .in('id', ids)

  if (error || !data) {
    console.error('[refrescarStocksVariantes]', error)
    return mapa
  }

  for (const v of data) {
    // Si la variante fue desactivada, tratamos como 0
    mapa.set(v.id, v.activa ? v.stock ?? 0 : 0)
  }

  return mapa
}