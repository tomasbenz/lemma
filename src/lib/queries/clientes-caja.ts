import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { CondIva } from './clientes-types'

export type ClienteCaja = {
  id: string
  razon_social: string
  cuit: string | null
  cond_iva: CondIva
}

// PostgREST capea en 1000 filas por request → paginar con .range() en loop.
// Mismo patrón que listarProductosCaja: un .limit(N) hardcoded trunca el
// catálogo cuando la empresa supera N filas.
const PAGE_SIZE = 1000

/**
 * Trae todos los clientes activos para el selector del modal de cobro.
 * Se llama al cargar /caja y el selector filtra localmente (instantáneo).
 * Paginado con range() en loop: trae TODOS los clientes activos.
 */
export async function cargarClientesCaja(): Promise<ClienteCaja[]> {
  const supabase = await createClient()

  type Fila = {
    id: string
    razon_social: string
    cuit: string | null
    cond_iva: string
  }

  const filas: Fila[] = []
  let offset = 0
  let lote: Fila[] = []

  do {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, razon_social, cuit, cond_iva')
      .eq('activo', true)
      .order('razon_social', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error || !data) {
      console.error('[cargarClientesCaja] Error página:', { offset, error })
      return []
    }

    lote = data
    filas.push(...lote)
    offset += PAGE_SIZE
  } while (lote.length === PAGE_SIZE) // lote lleno → puede haber más

  return filas.map((c) => ({
    id: c.id,
    razon_social: c.razon_social,
    cuit: c.cuit,
    cond_iva: c.cond_iva as CondIva,
  }))
}