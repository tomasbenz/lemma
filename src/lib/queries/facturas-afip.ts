import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Tipo de factura AFIP. Cubre facturas comunes (A/B/C) y NC/ND
 * incorporadas en Sprint 3.
 *
 * `factura_b` es el valor nuevo (mayo 2026) para emisor RI a CF/Exento.
 * `factura_c` queda como backcompat de ventas históricas — el sistema
 * nuevo persiste `factura_b` directamente.
 */
export type TipoFacturaDb =
  | 'factura_a'
  | 'factura_b'
  | 'factura_c'
  | 'nota_credito_a'
  | 'nota_credito_b'
  | 'nota_debito_a'
  | 'nota_debito_b'

export type EstadoFacturaAfip =
  | 'pendiente'
  | 'aprobada'
  | 'rechazada'
  | 'error'
  | 'anulada_por_nc'
  | 'aprobada_sin_persistir'

export type FacturaAfip = {
  id: string
  venta_id: string
  tipo_factura: TipoFacturaDb
  punto_venta: number
  numero_comprobante: number | null
  cae: string | null
  cae_vencimiento: string | null
  estado: EstadoFacturaAfip
  raw_response: Record<string, unknown> | null
  error_mensaje: string | null
  intentos: number
  created_at: string
  updated_at: string
  factura_asociada_id: string | null
}

/**
 * Resultado combinado: la factura ORIGINAL más reciente + (si existe) la
 * NC aprobada que la anuló.
 */
export type FacturaAfipConNc = {
  original: FacturaAfip
  notaCredito: FacturaAfip | null
}

/**
 * Trae la factura ORIGINAL más reciente de una venta + (si tiene) la NC
 * que la anuló.
 *
 * "Factura original" = `factura_asociada_id IS NULL`. Excluye NC/ND
 * cuando se busca la principal.
 *
 * Si la factura original está `anulada_por_nc`, busca la NC aprobada
 * asociada (con `factura_asociada_id = facturaOriginal.id`) y la
 * devuelve también.
 *
 * `empresaId` es REQUERIDO y se aplica como filtro explícito en ambas
 * queries internas. Defense in depth multitenant: aunque RLS protege,
 * el filtro explícito previene info disclosure cross-tenant si RLS
 * estuviera mal configurada.
 *
 * Devuelve:
 * - `null` si no hay factura ninguna (venta sin facturar todavía)
 * - `{ original, notaCredito: null }` si hay factura sin NC
 * - `{ original, notaCredito: <NC aprobada> }` si la factura está
 *   anulada por una NC
 */
export async function obtenerFacturaAfip(
  ventaId: string,
  empresaId: string,
): Promise<FacturaAfipConNc | null> {
  const supabase = await createClient()

  // Trae la factura original más reciente (excluyendo NC/ND).
  const { data: original, error: errOriginal } = await supabase
    .from('facturas_afip')
    .select('*')
    .eq('venta_id', ventaId)
    .eq('empresa_id', empresaId)
    .is('factura_asociada_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (errOriginal) {
    console.error('[obtenerFacturaAfip] error original:', errOriginal)
    return null
  }

  if (!original) return null

  const facturaOriginal = original as FacturaAfip

  // Si está anulada por NC, traer también la NC asociada (aprobada).
  // Incluye también 'aprobada_sin_persistir' — AFIP aprobo con CAE
  // valido pero el UPDATE final de persistencia fallo; el CAE igual
  // esta guardado en el campo `cae` y la NC debe mostrarse en la UI
  // para no romper la card con "No se encontro la NC asociada".
  let notaCredito: FacturaAfip | null = null
  if (facturaOriginal.estado === 'anulada_por_nc') {
    const { data: nc, error: errNc } = await supabase
      .from('facturas_afip')
      .select('*')
      .eq('factura_asociada_id', facturaOriginal.id)
      .eq('empresa_id', empresaId)
      .in('estado', ['aprobada', 'aprobada_sin_persistir'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (errNc) {
      console.error('[obtenerFacturaAfip] error NC asociada:', errNc)
      // Devolvemos sin NC para no romper la card. La factura sigue
      // marcada como anulada_por_nc visualmente.
    } else if (nc) {
      notaCredito = nc as FacturaAfip
    }
  }

  return { original: facturaOriginal, notaCredito }
}
