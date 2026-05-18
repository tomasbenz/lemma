// src/lib/turnos/calculos.ts
//
// Helpers puros para el módulo de turnos de caja. Tener la lógica acá
// (en lugar de embeberla en los server actions) facilita los tests y mantiene
// el cálculo de diferencias consistente entre cliente (preview en modal) y
// server (UPDATE definitivo via RPC cerrar_turno).

export type ValidacionMonto =
  | { ok: true; valor: number }
  | { ok: false; error: string }

/**
 * Valida un monto que representa efectivo en caja (base inicial o total
 * declarado). Debe ser un número finito ≥ 0.
 *
 * Parsea desde string (acepta coma como separador decimal) o number.
 * Devuelve discriminated union con el valor numérico o el error humano.
 */
export function validarMonto(input: unknown, etiqueta: string): ValidacionMonto {
  let numero: number
  if (typeof input === 'number') {
    numero = input
  } else if (typeof input === 'string') {
    const limpio = input.trim().replace(',', '.')
    if (limpio === '') {
      return { ok: false, error: `${etiqueta} es obligatorio` }
    }
    numero = Number(limpio)
  } else {
    return { ok: false, error: `${etiqueta} debe ser un número` }
  }

  if (!Number.isFinite(numero)) {
    return { ok: false, error: `${etiqueta} debe ser un número válido` }
  }
  if (numero < 0) {
    return { ok: false, error: `${etiqueta} no puede ser negativo` }
  }
  return { ok: true, valor: numero }
}

/**
 * Calcula la diferencia de caja redondeada a 2 decimales.
 * diferencia = declarado - teórico
 * Positiva: sobra plata en caja. Negativa: falta plata.
 *
 * Replica el round(declarado - teorico, 2) de la RPC cerrar_turno para
 * que el preview en cliente y el cálculo server coincidan al centavo.
 */
export function calcularDiferencia(
  totalDeclarado: number,
  totalTeorico: number
): number {
  return Math.round((totalDeclarado - totalTeorico) * 100) / 100
}

/**
 * Calcula el total teórico de efectivo en caja: base inicial + efectivo
 * cobrado en ventas no anuladas.
 */
export function calcularTotalTeorico(
  baseInicial: number,
  totalEfectivoVentas: number
): number {
  return Math.round((baseInicial + totalEfectivoVentas) * 100) / 100
}

/**
 * Considera "cero" cuando la diferencia es menor a 1 centavo (tolerancia
 * de floating point). Útil para colorear UI o decidir si hay alerta.
 */
export function diferenciaEsCero(diferencia: number): boolean {
  return Math.abs(diferencia) < 0.01
}
