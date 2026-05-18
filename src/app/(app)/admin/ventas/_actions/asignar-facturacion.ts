// src/app/(app)/admin/ventas/_actions/asignar-facturacion.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { derivarTipoFactura } from '@/lib/afip/derivar-tipo-factura'
import { emitirFacturaAfip } from './emitir-factura-afip'

export type AsignarFacturacionInput = {
  ventaId: string
  // Mantenemos el campo aunque hoy solo acepte 'con_factura' — auditoria
  // futura y para que el call site no cambie de forma significativa.
  tipoFactura: 'con_factura'
  montoFacturado: number
}

export type AsignarFacturacionResult =
  | { ok: true; cae?: string; numero?: number }
  | { ok: false; error: string }

/**
 * Asigna tipo_factura + monto_facturado a una venta que estaba como
 * 'sin_factura', y dispara la emisión AFIP en el mismo flujo.
 *
 * Lo usa el admin desde el detalle de venta cuando la vendedora cerró
 * la venta sin facturación (workflow de opción C).
 *
 * Reglas:
 * - Solo admin/superadmin
 * - Solo ventas en estado 'cerrada' (no anuladas, no guardadas)
 * - Solo ventas que tienen tipo_factura = 'sin_factura' (no pisar facturas ya asignadas)
 * - El monto facturado debe ser > 0 y <= total
 * - El tipo (A vs B) se deriva del cond_iva del cliente, no se elige.
 */
export async function asignarFacturacion(
  input: AsignarFacturacionInput
): Promise<AsignarFacturacionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }
    if (!user.empresa_id) {
      return { ok: false, error: 'La venta no existe' }
    }

    if (input.tipoFactura !== 'con_factura') {
      return { ok: false, error: 'Tipo de factura inválido' }
    }

    if (
      typeof input.montoFacturado !== 'number' ||
      input.montoFacturado <= 0
    ) {
      return { ok: false, error: 'Monto facturado debe ser mayor a 0' }
    }

    const supabase = await createClient()

    // Validar venta. Defense in depth: scope explicito por empresa_id,
    // mismo mensaje generico ante "no existe" o "es de otra empresa".
    const { data: venta, error: errVenta } = await supabase
      .from('ventas')
      .select('id, estado, tipo_factura, total, cliente_id')
      .eq('id', input.ventaId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (errVenta || !venta) {
      return { ok: false, error: 'La venta no existe' }
    }
    if (venta.estado !== 'cerrada') {
      return {
        ok: false,
        error: 'Solo se puede asignar facturación a ventas cerradas',
      }
    }
    if (venta.tipo_factura !== 'sin_factura') {
      return {
        ok: false,
        error: 'Esta venta ya tiene tipo de factura asignado',
      }
    }
    if (input.montoFacturado > venta.total + 0.01) {
      return {
        ok: false,
        error: `Monto facturado (${input.montoFacturado}) supera el total de la venta (${venta.total})`,
      }
    }

    // Derivar tipo segun cond_iva del cliente (cargado en la venta).
    // Mismo helper que cerrar-venta.ts → un solo lugar de verdad.
    let clienteParaDerivar = null
    if (venta.cliente_id !== null) {
      const { data: clienteData } = await supabase
        .from('clientes')
        .select('cond_iva, cuit')
        .eq('id', venta.cliente_id)
        .maybeSingle()
      clienteParaDerivar = clienteData ?? null
    }

    const derivacion = derivarTipoFactura({
      tipoFactura: 'con_factura',
      cliente: clienteParaDerivar,
    })

    if (!derivacion.ok) {
      // Unico motivo posible: RI sin CUIT valido.
      return {
        ok: false,
        error:
          'El cliente RI no tiene CUIT cargado. Editá el cliente o reasigná la venta a Consumidor Final.',
      }
    }

    // En este caller, 'sin_factura' no aplica (input es 'con_factura').
    // Afinamos el tipo a A|B para usar en el UPDATE.
    const tipoDerivado = derivacion.tipo as 'factura_a' | 'factura_b'

    // Actualizar venta con el tipo derivado.
    // Defense in depth: ademas de la PK, scope por empresa_id.
    const { error: errUpdate } = await supabase
      .from('ventas')
      .update({
        tipo_factura: tipoDerivado,
        monto_facturado: input.montoFacturado,
      } as never)
      .eq('id', input.ventaId)
      .eq('empresa_id', user.empresa_id)

    if (errUpdate) {
      console.error('[asignarFacturacion] Update error:', errUpdate)
      return { ok: false, error: errUpdate.message }
    }

    // Audit log con tipo derivado real (no 'con_factura').
    await supabase.from('audit_log').insert({
      empresa_id: user.empresa_id,
      usuario_id: user.id,
      accion: 'asignar_facturacion',
      entidad: 'ventas',
      entidad_id: input.ventaId,
      detalles: {
        tipo_factura: tipoDerivado,
        monto_facturado: input.montoFacturado,
      },
    } as never)

    revalidatePath(`/admin/ventas/${input.ventaId}`)
    revalidatePath('/admin/ventas')

    // Disparar emisión AFIP
    const resultadoEmision = await emitirFacturaAfip(input.ventaId)

    if (!resultadoEmision.ok) {
      // La venta quedó con tipo_factura asignado pero la emisión falló.
      // El admin puede reintentar después desde el botón "Reintentar emisión".
      return {
        ok: false,
        error: `Tipo de factura asignado, pero AFIP falló: ${resultadoEmision.error}. Podés reintentar la emisión desde el detalle.`,
      }
    }

    return {
      ok: true,
      cae: resultadoEmision.cae,
      numero: resultadoEmision.numero,
    }
  } catch (err) {
    console.error('[asignarFacturacion] Error inesperado:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
