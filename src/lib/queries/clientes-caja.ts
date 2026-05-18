import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { CondIva } from './clientes-types'

export type ClienteCaja = {
  id: string
  razon_social: string
  cuit: string | null
  cond_iva: CondIva
}

/**
 * Trae todos los clientes activos para el selector del modal de cobro.
 * Se llama al cargar /caja y el selector filtra localmente (instantáneo).
 */
export async function cargarClientesCaja(): Promise<ClienteCaja[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clientes')
    .select('id, razon_social, cuit, cond_iva')
    .eq('activo', true)
    .order('razon_social', { ascending: true })
    .limit(1000)

  if (error || !data) {
    console.error('[cargarClientesCaja]', error)
    return []
  }

  return data.map((c) => ({
    id: c.id,
    razon_social: c.razon_social,
    cuit: c.cuit,
    cond_iva: c.cond_iva as CondIva,
  }))
}