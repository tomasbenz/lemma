// Cálculos puros del flujo de cobro / finalización de pedido.
//
// Espejado de la lógica que está como `useMemo` dentro de
// `src/app/(app)/caja/_components/modal-cobro.tsx` y
// `src/app/(app)/admin/pedidos/[id]/_components/pedido-detalle-view.tsx`.
//
// Tener estas funciones extraídas permite:
//  - testear la matemática del flujo sin levantar React
//  - garantizar invariantes fiscales (totalACobrar, montoFacturado, saldo)
//    cuando se cambia el componente
//  - reutilizar las mismas reglas en futuros endpoints / scripts

export const RECARGO_FACTURA_COMPLETA_FACTOR = 1.105 as const;
export const PORCENTAJES_FACTURADO_PRESET = [30, 50, 100] as const;
export const TOLERANCIA_CENTAVOS = 0.01 as const;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * True si `n` es un número finito (no NaN, no Infinity, no -Infinity).
 * Usar en validación de inputs monetarios/cantidades que vienen del cliente
 * antes de mandarlos a una RPC: comparaciones como `n < 0` o `n <= 0`
 * devuelven false para NaN, así que sin este check los valores basura pasan.
 */
export function esMontoFinito(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Total a cobrar al cliente. Prioridad: recargo 10,5% > recargo manual > sin recargo.
 * Espejo exacto del useMemo en modal-cobro.tsx (líneas 117-123).
 */
export function calcularTotalACobrar(
  totalNeto: number,
  recargoFacturaCompleta: boolean,
  recargoManualPorcentaje: number | null,
): number {
  if (recargoFacturaCompleta) {
    return round2(totalNeto * RECARGO_FACTURA_COMPLETA_FACTOR);
  }
  if (recargoManualPorcentaje !== null) {
    return round2(totalNeto * (1 + recargoManualPorcentaje / 100));
  }
  return totalNeto;
}

/**
 * Monto del recargo 10,5% sobre el neto. 0 si no está activo.
 */
export function calcularRecargoMonto(
  totalNeto: number,
  recargoFacturaCompleta: boolean,
): number {
  if (!recargoFacturaCompleta) return 0;
  return round2(totalNeto * (RECARGO_FACTURA_COMPLETA_FACTOR - 1));
}

/**
 * Monto del recargo manual aplicado sobre el neto. 0 si null.
 */
export function calcularRecargoManualMonto(
  totalNeto: number,
  recargoManualPorcentaje: number | null,
): number {
  if (recargoManualPorcentaje === null) return 0;
  return round2(totalNeto * (recargoManualPorcentaje / 100));
}

/**
 * Descuento aplicado a partir del subtotal y un porcentaje.
 * Clampa el porcentaje a [0, 100] para no producir descuentos negativos
 * ni exceder el subtotal.
 */
export function calcularDescuentoAplicado(
  subtotal: number,
  descuentoPct: number | null,
): number {
  const pctClamp = Math.min(Math.max(descuentoPct ?? 0, 0), 100);
  return round2((subtotal * pctClamp) / 100);
}

/**
 * Calcula el descuento aplicado a partir de un monto absoluto.
 * Clampea entre 0 y subtotal (no permite descuento > subtotal).
 */
export function calcularDescuentoDesdeMonto(
  subtotal: number,
  montoDescuento: number | null,
): number {
  if (montoDescuento === null || montoDescuento <= 0) return 0;
  return round2(Math.min(Math.max(0, montoDescuento), subtotal));
}

export type DescuentoModo = "porcentaje" | "monto";

/**
 * Total neto = subtotal - descuento. Nunca negativo.
 */
export function calcularTotalNeto(
  subtotal: number,
  descuentoAplicado: number,
): number {
  return Math.max(0, subtotal - descuentoAplicado);
}

export type MedioLineaInput = { monto: number | null };

/**
 * Suma de montos de los medios. null cuenta como 0.
 */
export function calcularSumaMedios(medios: MedioLineaInput[]): number {
  return medios.reduce((acc, m) => acc + (m.monto ?? 0), 0);
}

export type Saldo = {
  sumaMedios: number;
  diferencia: number;
  saldoOk: boolean;
};

/**
 * Suma de medios, diferencia con totalACobrar y si el saldo está OK.
 * saldoOk usa tolerancia de 0.01 por floating point.
 */
export function calcularSaldo(
  medios: MedioLineaInput[],
  totalACobrar: number,
): Saldo {
  const sumaMedios = calcularSumaMedios(medios);
  const diferencia = totalACobrar - sumaMedios;
  const saldoOk = Math.abs(diferencia) < TOLERANCIA_CENTAVOS;
  return { sumaMedios, diferencia, saldoOk };
}

/**
 * Saca medios con monto null o ≤ 0. Preserva el orden y los campos
 * extra del tipo de entrada (medio, referencia, id, etc.).
 */
export function filtrarMediosConMonto<T extends MedioLineaInput>(
  medios: T[],
): T[] {
  return medios.filter((m) => m.monto !== null && m.monto > 0);
}

/**
 * Detecta si el monto facturado coincide con uno de los porcentajes preset
 * sobre el totalACobrar (tolera floating point con TOLERANCIA_CENTAVOS).
 * null si no coincide con ninguno, si monto es null o si monto es 0.
 */
export function detectarPorcentajeFacturado(
  montoFacturado: number | null,
  totalACobrar: number,
  presets: readonly number[] = PORCENTAJES_FACTURADO_PRESET,
): number | null {
  if (!montoFacturado) return null;
  for (const p of presets) {
    const valorEsperado = round2(totalACobrar * (p / 100));
    if (Math.abs(montoFacturado - valorEsperado) < TOLERANCIA_CENTAVOS) {
      return p;
    }
  }
  return null;
}

/**
 * Monto que corresponde a un porcentaje del totalACobrar.
 */
export function calcularMontoPorPorcentaje(
  totalACobrar: number,
  porcentaje: number,
): number {
  return round2(totalACobrar * (porcentaje / 100));
}

/**
 * Regla fiscal: con cualquier recargo (10,5% o manual), solo se puede facturar
 * el 100% del total. Con porcentajes parciales (30%, 50%) se rompería la
 * relación entre lo cobrado y lo facturado.
 */
export function permitePorcentajeFacturado(
  porcentaje: number,
  recargoFacturaCompleta: boolean,
  recargoManualPorcentaje: number | null,
): boolean {
  if (porcentaje === 100) return true;
  if (recargoFacturaCompleta) return false;
  if (recargoManualPorcentaje !== null) return false;
  return true;
}
