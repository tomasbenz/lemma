// src/lib/afip/derivar-tipo-factura.ts
//
// Funcion pura que deriva el tipo final de factura desde el input UI
// + cond_iva/cuit del cliente. Se usa en cerrar-venta.ts y
// asignar-facturacion.ts. Aislada para poder testearla unitariamente
// sin tocar DB ni AFIP.

export type CondIvaCliente = 'RI' | 'MONO' | 'CF' | 'EX'

export type ClienteParaDerivar = {
  cond_iva: CondIvaCliente
  cuit: string | null
}

export type DerivarTipoInput = {
  tipoFactura: 'sin_factura' | 'con_factura'
  /**
   * null cuando: (a) la venta no tiene cliente seleccionado, o
   * (b) el cliente fue borrado/RLS lo oculto entre la seleccion y
   *     el submit. Ambos casos se tratan igual: CF anonimo → B.
   */
  cliente: ClienteParaDerivar | null
}

export type DerivarTipoFinal = 'sin_factura' | 'factura_a' | 'factura_b'

export type DerivarResult =
  | { ok: true; tipo: DerivarTipoFinal }
  | { ok: false; reason: 'ri_sin_cuit' }

/**
 * Reglas:
 * - 'sin_factura'                                  → 'sin_factura'
 * - 'con_factura' + cliente null                   → 'factura_b'  (CF anonimo)
 * - 'con_factura' + cond_iva RI + CUIT 11 digitos  → 'factura_a'
 * - 'con_factura' + cond_iva RI + CUIT invalido    → error ri_sin_cuit
 * - 'con_factura' + cond_iva MONO/CF/EX            → 'factura_b'
 *
 * Devuelve `reason` en lugar de un string de error para que cada caller
 * (caja vs admin) traduzca al mensaje contextual correcto.
 */
export function derivarTipoFactura(input: DerivarTipoInput): DerivarResult {
  if (input.tipoFactura === 'sin_factura') {
    return { ok: true, tipo: 'sin_factura' }
  }

  if (input.cliente === null) {
    return { ok: true, tipo: 'factura_b' }
  }

  if (input.cliente.cond_iva === 'RI') {
    const cuitNormalizado = input.cliente.cuit?.replace(/-/g, '') ?? ''
    if (cuitNormalizado.length !== 11) {
      return { ok: false, reason: 'ri_sin_cuit' }
    }
    return { ok: true, tipo: 'factura_a' }
  }

  // MONO / CF / EX → B
  return { ok: true, tipo: 'factura_b' }
}
