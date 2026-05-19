// src/lib/medios-pago.ts
//
// Source of truth para labels y colores (paleta achromatic) de medios de pago.
// Usado en reportes y en el listado de turnos.

export const LABELS_MEDIO_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago_qr: 'Mercado Pago QR',
  mercadopago: 'Mercado Pago',
  tarjeta_credito: 'Tarjeta crédito',
  tarjeta_debito: 'Tarjeta débito',
  cheque: 'Cheque',
  otro: 'Otro',
}

// Paleta achromatic: solo tonos de foreground con opacidad variable.
// El medio con más volumen va con el tono más fuerte (lectura directa).
export const COLORES_MEDIO_PAGO: Record<string, string> = {
  efectivo: 'bg-foreground',
  transferencia: 'bg-foreground/75',
  mercadopago_qr: 'bg-foreground/55',
  mercadopago: 'bg-foreground/55',
  tarjeta_credito: 'bg-foreground/40',
  tarjeta_debito: 'bg-foreground/40',
  deposito: 'bg-foreground/25',
  cheque: 'bg-foreground/25',
  otro: 'bg-foreground/15',
}

export function labelMedioPago(medio: string): string {
  return LABELS_MEDIO_PAGO[medio] ?? medio
}

export function colorMedioPago(medio: string): string {
  return COLORES_MEDIO_PAGO[medio] ?? 'bg-foreground/15'
}
