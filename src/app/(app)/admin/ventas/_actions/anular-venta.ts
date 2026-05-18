// src/app/(app)/admin/ventas/_actions/anular-venta.ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

type AnularVentaResult =
  | { ok: true; ventaId: string; numero: number }
  | { ok: false; error: string }

/**
 * Anula una venta cerrada, restaurando el stock.
 * Llama a la función PostgreSQL `anular_venta` (transaccional).
 *
 * Solo admin y superadmin pueden anular.
 */
export async function anularVenta(
  ventaId: string,
  motivo: string
): Promise<AnularVentaResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'Sin permisos para anular ventas' }
    }
    if (!ventaId) {
      return { ok: false, error: 'ID de venta inválido' }
    }

    const motivoLimpio = motivo?.trim() ?? ''
    if (!motivoLimpio) {
      return { ok: false, error: 'El motivo es obligatorio' }
    }

    // Defense in depth sobre RLS: sin empresa_id no hay venta consultable.
    if (!user.empresa_id) {
      return { ok: false, error: 'La venta no existe' }
    }

    const headersList = await headers()
    const ip =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      null
    const userAgent = headersList.get('user-agent') ?? null

    const supabase = await createClient()

    const { data: existe } = await supabase
      .from('ventas')
      .select('id')
      .eq('id', ventaId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (!existe) {
      return { ok: false, error: 'La venta no existe' }
    }

    // ============================================================
    // Detectar factura AFIP aprobada activa
    // ============================================================
    // Si la venta tiene una factura aprobada que NO es NC/ND
    // (factura_asociada_id IS NULL), hay que emitir Nota de Crédito
    // ANTES de anular fiscalmente. Si la NC falla, abortamos sin
    // anular: el admin reintenta o resuelve el problema fiscal.
    const { data: facturaActiva } = await supabase
      .from('facturas_afip')
      .select('id, numero_comprobante, tipo_factura')
      .eq('venta_id', ventaId)
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'aprobada')
      .is('factura_asociada_id', null)
      .maybeSingle()

    if (facturaActiva) {
      // Import dinámico para mantener desacople con el server action de NC
      // y evitar ciclos potenciales en el árbol de imports.
      const { emitirNotaCreditoAfip } = await import('./emitir-nota-credito-afip')
      const resultadoNC = await emitirNotaCreditoAfip(
        facturaActiva.id,
        motivoLimpio,
      )

      if (!resultadoNC.ok) {
        // NC falló. NO anulamos la venta — la PG además bloquearía la
        // anulación porque la factura sigue 'aprobada'. Devolvemos el
        // error visible al admin para que pueda actuar.
        return {
          ok: false,
          error: `No se puede anular la venta porque falló la emisión de Nota de Crédito: ${resultadoNC.error}`,
        }
      }

      // NC OK: la factura original quedó como 'anulada_por_nc'. La PG
      // anular_venta ya no la va a encontrar como factura aprobada activa.
    }

    const { data, error } = await supabase.rpc('anular_venta', {
      p_venta_id: ventaId,
      p_motivo: motivoLimpio,
      p_ip: ip,
      p_user_agent: userAgent,
    } as never)

    if (error) {
      console.error('[anularVenta] Error RPC:', error)
      return {
        ok: false,
        error: error.message || 'Error al anular la venta',
      }
    }

    // anular_venta devuelve un row de la tabla ventas, no un jsonb con .ok
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Respuesta inválida del servidor' }
    }

    const ventaRow = data as { id?: string; numero?: number }
    if (!ventaRow.id) {
      return { ok: false, error: 'La venta no pudo anularse' }
    }

    revalidatePath('/admin/ventas')
    revalidatePath(`/admin/ventas/${ventaId}`)
    revalidatePath('/admin/productos')
    revalidatePath('/caja')

    return {
      ok: true,
      ventaId: ventaRow.id,
      numero: ventaRow.numero ?? 0,
    }
  } catch (err) {
    console.error('[anularVenta] Error:', err)
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}