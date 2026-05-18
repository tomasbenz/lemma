import type { TipoFacturaAfip } from './types'

const IVA_RATE = 0.21

export type DescomposicionFactura = {
  /** Neto gravado (sin IVA). Para factura A va al campo ImpNeto de AFIP. */
  netoGravado: number
  /** IVA discriminado. Cero para factura C. */
  iva: number
  /** Total final que paga el cliente. Coincide con monto_facturado. */
  total: number
}

/**
 * Descompone el monto facturado en neto + IVA según el tipo de factura.
 *
 * Bajo el modelo de IVA actual (precios netos, sin sumar 21% al cobrar),
 * `monto_facturado` ya es el total final que paga el cliente:
 *   - Factura A (RI a RI/MONO) y Factura B (RI a CF/Exento): AFIP requiere
 *     neto + IVA discriminado, así que descomponemos hacia atrás dividiendo
 *     por 1.21.
 *   - Factura C (monotributo emisor): AFIP no discrimina IVA, todo va como
 *     neto. Para emisores RI no aplica — queda como backcompat.
 *
 * El IVA absorbe el redondeo: `netoGravado + iva === total` siempre.
 */
export function descomponerFactura(
  montoFacturado: number,
  tipo: TipoFacturaAfip,
): DescomposicionFactura {
  const total = round2(montoFacturado)

  // factura_a (RI a RI/MONO) y factura_b (RI a CF/Exento): mismo
  // tratamiento — descomponer hacia atrás dividiendo por 1.21.
  // factura_c (monotributo emisor) sigue sin descomponer.
  if (tipo === 'factura_a' || tipo === 'factura_b') {
    // Método ortodoxo AFIP: calcular IVA primero como porcentaje
    // del total, después derivar neto = total - iva. Genera menos
    // colisiones de redondeo contra la validación de AFIP
    // (que recalcula iva = baseImp * 0.21 y exige tolerancia 0.01).
    const iva = round2((total * IVA_RATE) / (1 + IVA_RATE))
    const netoGravado = round2(total - iva)
    return { netoGravado, iva, total }
  }

  return { netoGravado: total, iva: 0, total }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
