import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  calcularDescuentoAplicado,
  calcularDescuentoDesdeMonto,
  calcularMontoPorPorcentaje,
  calcularRecargoManualMonto,
  calcularRecargoMonto,
  calcularSaldo,
  calcularSumaMedios,
  calcularTotalACobrar,
  calcularTotalNeto,
  detectarPorcentajeFacturado,
  esMontoFinito,
  filtrarMediosConMonto,
  permitePorcentajeFacturado,
  PORCENTAJES_FACTURADO_PRESET,
  round2,
} from "./calculos";

// ============================================================================
// calcularTotalACobrar — la base de todo el flujo
// ============================================================================

test("calcularTotalACobrar — sin recargo devuelve el neto tal cual", () => {
  assert.equal(calcularTotalACobrar(1000, false, null), 1000);
  assert.equal(calcularTotalACobrar(0, false, null), 0);
  assert.equal(calcularTotalACobrar(12345.67, false, null), 12345.67);
});

test("calcularTotalACobrar — recargo 10,5% multiplica por 1.105 y redondea", () => {
  assert.equal(calcularTotalACobrar(1000, true, null), 1105);
  assert.equal(calcularTotalACobrar(100, true, null), 110.5);
  // 1234.56 * 1.105 = 1364.1888 → 1364.19
  assert.equal(calcularTotalACobrar(1234.56, true, null), 1364.19);
});

test("calcularTotalACobrar — recargo manual aplica porcentaje variable", () => {
  assert.equal(calcularTotalACobrar(1000, false, 5), 1050);
  assert.equal(calcularTotalACobrar(1000, false, 10), 1100);
  assert.equal(calcularTotalACobrar(1000, false, 25), 1250);
  assert.equal(calcularTotalACobrar(1000, false, 50), 1500);
});

test("calcularTotalACobrar — prioridad: 10,5% gana sobre manual", () => {
  // Si por algún bug ambos están activos, el 10,5% manda
  assert.equal(calcularTotalACobrar(1000, true, 50), 1105);
});

test("calcularTotalACobrar — recargo manual 0% es como 0 recargo", () => {
  assert.equal(calcularTotalACobrar(1000, false, 0), 1000);
});

test("calcularTotalACobrar — totales con fracción se redondean al centavo", () => {
  // 1000.555 * 1.105 = 1105.613... → 1105.61
  assert.equal(calcularTotalACobrar(1000.555, true, null), 1105.61);
});

// ============================================================================
// calcularRecargoMonto / calcularRecargoManualMonto
// ============================================================================

test("calcularRecargoMonto — 0 cuando no está activo", () => {
  assert.equal(calcularRecargoMonto(1000, false), 0);
});

test("calcularRecargoMonto — 10,5% activo da total * 0.105", () => {
  assert.equal(calcularRecargoMonto(1000, true), 105);
  assert.equal(calcularRecargoMonto(2000, true), 210);
});

test("calcularRecargoManualMonto — null da 0", () => {
  assert.equal(calcularRecargoManualMonto(1000, null), 0);
});

test("calcularRecargoManualMonto — porcentaje aplica y redondea", () => {
  assert.equal(calcularRecargoManualMonto(1000, 5), 50);
  assert.equal(calcularRecargoManualMonto(1000, 12.5), 125);
  // 1234.56 * 0.07 = 86.4192 → 86.42
  assert.equal(calcularRecargoManualMonto(1234.56, 7), 86.42);
});

test("calcularRecargoManualMonto — 0% da 0", () => {
  assert.equal(calcularRecargoManualMonto(1000, 0), 0);
});

// ============================================================================
// Descuento y total neto
// ============================================================================

test("calcularDescuentoAplicado — null o 0% da 0", () => {
  assert.equal(calcularDescuentoAplicado(1000, null), 0);
  assert.equal(calcularDescuentoAplicado(1000, 0), 0);
});

test("calcularDescuentoAplicado — porcentaje aplica al subtotal", () => {
  assert.equal(calcularDescuentoAplicado(1000, 10), 100);
  assert.equal(calcularDescuentoAplicado(1000, 50), 500);
  assert.equal(calcularDescuentoAplicado(1000, 100), 1000);
});

test("calcularDescuentoAplicado — clampa porcentaje negativo a 0", () => {
  assert.equal(calcularDescuentoAplicado(1000, -10), 0);
});

test("calcularDescuentoAplicado — clampa porcentaje >100 a 100", () => {
  assert.equal(calcularDescuentoAplicado(1000, 150), 1000);
});

test("calcularTotalNeto — subtotal - descuento, nunca negativo", () => {
  assert.equal(calcularTotalNeto(1000, 100), 900);
  assert.equal(calcularTotalNeto(1000, 1000), 0);
  // Defensivo: si descuento > subtotal por algún bug, no devolver negativo
  assert.equal(calcularTotalNeto(1000, 1500), 0);
});

// ============================================================================
// Medios de pago: suma, saldo, filtro
// ============================================================================

test("calcularSumaMedios — vacío da 0", () => {
  assert.equal(calcularSumaMedios([]), 0);
});

test("calcularSumaMedios — null cuenta como 0", () => {
  assert.equal(
    calcularSumaMedios([{ monto: null }, { monto: 100 }, { monto: null }]),
    100,
  );
});

test("calcularSumaMedios — suma de varios medios", () => {
  assert.equal(
    calcularSumaMedios([{ monto: 100 }, { monto: 200 }, { monto: 50.5 }]),
    350.5,
  );
});

test("calcularSaldo — saldoOk cuando suma === totalACobrar", () => {
  const r = calcularSaldo([{ monto: 1000 }], 1000);
  assert.equal(r.sumaMedios, 1000);
  assert.equal(r.diferencia, 0);
  assert.equal(r.saldoOk, true);
});

test("calcularSaldo — tolerancia de 1 centavo absorbe floating point", () => {
  // Sumar 0.1 + 0.2 en JS da 0.30000000000000004
  const r = calcularSaldo(
    [{ monto: 0.1 }, { monto: 0.2 }],
    0.3,
  );
  assert.equal(r.saldoOk, true);
});

test("calcularSaldo — diferencia positiva = falta cubrir", () => {
  const r = calcularSaldo([{ monto: 500 }], 1000);
  assert.equal(r.diferencia, 500);
  assert.equal(r.saldoOk, false);
});

test("calcularSaldo — diferencia negativa = sobra plata", () => {
  const r = calcularSaldo([{ monto: 1500 }], 1000);
  assert.equal(r.diferencia, -500);
  assert.equal(r.saldoOk, false);
});

test("calcularSaldo — multimedio que cubre exacto el total", () => {
  const r = calcularSaldo(
    [{ monto: 300 }, { monto: 500 }, { monto: 200 }],
    1000,
  );
  assert.equal(r.saldoOk, true);
});

test("filtrarMediosConMonto — saca null y 0, deja > 0", () => {
  const medios = [
    { id: "a", monto: 100 },
    { id: "b", monto: null },
    { id: "c", monto: 0 },
    { id: "d", monto: 50 },
  ];
  const r = filtrarMediosConMonto(medios);
  assert.deepEqual(
    r.map((m) => m.id),
    ["a", "d"],
  );
});

test("filtrarMediosConMonto — preserva orden y campos extra", () => {
  type M = { id: string; monto: number | null; medio: string; ref: string };
  const medios: M[] = [
    { id: "a", monto: 100, medio: "efectivo", ref: "" },
    { id: "b", monto: null, medio: "transferencia", ref: "X" },
    { id: "c", monto: 50, medio: "deposito", ref: "Y" },
  ];
  const r = filtrarMediosConMonto(medios);
  assert.equal(r.length, 2);
  assert.equal(r[0].medio, "efectivo");
  assert.equal(r[1].medio, "deposito");
  assert.equal(r[1].ref, "Y");
});

// ============================================================================
// Detección de porcentaje preset y aplicación
// ============================================================================

test("detectarPorcentajeFacturado — null cuando monto facturado es 0 o null", () => {
  assert.equal(detectarPorcentajeFacturado(0, 1000), null);
  assert.equal(detectarPorcentajeFacturado(null, 1000), null);
});

test("detectarPorcentajeFacturado — detecta 30%, 50% y 100%", () => {
  assert.equal(detectarPorcentajeFacturado(300, 1000), 30);
  assert.equal(detectarPorcentajeFacturado(500, 1000), 50);
  assert.equal(detectarPorcentajeFacturado(1000, 1000), 100);
});

test("detectarPorcentajeFacturado — devuelve null para valores arbitrarios", () => {
  assert.equal(detectarPorcentajeFacturado(400, 1000), null);
  assert.equal(detectarPorcentajeFacturado(750, 1000), null);
});

test("detectarPorcentajeFacturado — tolera floating point al borde", () => {
  // Si el cálculo da 331.5 vs preset 331.50, debe detectar 30%
  // sobre un totalACobrar irregular
  assert.equal(detectarPorcentajeFacturado(331.50, 1105), 30);
  assert.equal(detectarPorcentajeFacturado(552.50, 1105), 50);
  assert.equal(detectarPorcentajeFacturado(1105, 1105), 100);
});

test("detectarPorcentajeFacturado — no confunde 30 con 50 en bordes", () => {
  // Si monto está entre 30% y 50%, debe ser null (no devolver 30 ni 50)
  assert.equal(detectarPorcentajeFacturado(400, 1000), null);
});

test("calcularMontoPorPorcentaje — 100% da el total exacto", () => {
  assert.equal(calcularMontoPorPorcentaje(1000, 100), 1000);
  assert.equal(calcularMontoPorPorcentaje(1234.56, 100), 1234.56);
});

test("calcularMontoPorPorcentaje — 30% y 50% sobre total irregular", () => {
  // 1105 * 0.30 = 331.5
  assert.equal(calcularMontoPorPorcentaje(1105, 30), 331.5);
  // 1364.19 * 0.50 = 682.095 → 682.10
  assert.equal(calcularMontoPorPorcentaje(1364.19, 50), 682.1);
});

// ============================================================================
// Regla fiscal: con recargo, solo se factura 100%
// ============================================================================

test("permitePorcentajeFacturado — 100% siempre permitido", () => {
  assert.equal(permitePorcentajeFacturado(100, true, null), true);
  assert.equal(permitePorcentajeFacturado(100, false, 10), true);
  assert.equal(permitePorcentajeFacturado(100, true, 10), true);
  assert.equal(permitePorcentajeFacturado(100, false, null), true);
});

test("permitePorcentajeFacturado — 30/50 bloqueado con recargo 10,5%", () => {
  assert.equal(permitePorcentajeFacturado(30, true, null), false);
  assert.equal(permitePorcentajeFacturado(50, true, null), false);
});

test("permitePorcentajeFacturado — 30/50 bloqueado con recargo manual", () => {
  assert.equal(permitePorcentajeFacturado(30, false, 5), false);
  assert.equal(permitePorcentajeFacturado(50, false, 25), false);
});

test("permitePorcentajeFacturado — 30/50 permitido sin recargo", () => {
  assert.equal(permitePorcentajeFacturado(30, false, null), true);
  assert.equal(permitePorcentajeFacturado(50, false, null), true);
});

// ============================================================================
// FLUJOS COMPLETOS: combinaciones que puede hacer el cliente
// ============================================================================

test("flujo — venta simple: sin descuento, sin recargo, factura 100%", () => {
  const subtotal = 10000;
  const descuento = calcularDescuentoAplicado(subtotal, null);
  const totalNeto = calcularTotalNeto(subtotal, descuento);
  const totalACobrar = calcularTotalACobrar(totalNeto, false, null);
  const medios = [{ monto: totalACobrar }];
  const saldo = calcularSaldo(medios, totalACobrar);

  assert.equal(descuento, 0);
  assert.equal(totalNeto, 10000);
  assert.equal(totalACobrar, 10000);
  assert.equal(saldo.saldoOk, true);
});

test("flujo — descuento 10% + recargo 10,5% + 100% facturado", () => {
  const subtotal = 10000;
  const descuento = calcularDescuentoAplicado(subtotal, 10); // 1000
  const totalNeto = calcularTotalNeto(subtotal, descuento); // 9000
  const totalACobrar = calcularTotalACobrar(totalNeto, true, null); // 9945
  const recargoMonto = calcularRecargoMonto(totalNeto, true); // 945
  const montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 100);
  const medios = [{ monto: totalACobrar }];
  const saldo = calcularSaldo(medios, totalACobrar);

  assert.equal(descuento, 1000);
  assert.equal(totalNeto, 9000);
  assert.equal(totalACobrar, 9945);
  assert.equal(recargoMonto, 945);
  assert.equal(montoFacturado, 9945);
  assert.equal(saldo.saldoOk, true);

  // Invariante fiscal: el monto facturado coincide con lo cobrado
  assert.equal(montoFacturado, totalACobrar);
});

test("flujo — recargo manual 7% + 3 medios que cubren exacto", () => {
  const totalNeto = 50000;
  const totalACobrar = calcularTotalACobrar(totalNeto, false, 7); // 53500
  assert.equal(totalACobrar, 53500);

  const medios = [
    { monto: 20000 }, // efectivo
    { monto: 25000 }, // transferencia
    { monto: 8500 }, // depósito
  ];
  const saldo = calcularSaldo(medios, totalACobrar);
  assert.equal(saldo.sumaMedios, 53500);
  assert.equal(saldo.saldoOk, true);
});

test("flujo — recargo manual: facturar 30% queda bloqueado", () => {
  const totalNeto = 10000;
  const totalACobrar = calcularTotalACobrar(totalNeto, false, 10); // 11000

  // Cliente quiere facturar 30%? No se permite con recargo activo
  assert.equal(permitePorcentajeFacturado(30, false, 10), false);
  // Solo 100% pasa
  assert.equal(permitePorcentajeFacturado(100, false, 10), true);

  // Si se respeta la regla, monto facturado = total cobrado
  const montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 100);
  assert.equal(montoFacturado, 11000);
});

test("flujo — sin recargo: facturar 30% es válido", () => {
  const totalNeto = 10000;
  const totalACobrar = calcularTotalACobrar(totalNeto, false, null); // 10000

  assert.equal(permitePorcentajeFacturado(30, false, null), true);
  const montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 30);
  assert.equal(montoFacturado, 3000);

  // El detector debe reconocer que es 30%
  const detectado = detectarPorcentajeFacturado(montoFacturado, totalACobrar);
  assert.equal(detectado, 30);
});

test("flujo — medios con $0 se filtran antes de mandar al server", () => {
  const totalACobrar = 1000;
  // La cajera deja un medio en $0 sin querer
  const mediosVisibles = [
    { monto: 600, medio: "efectivo" },
    { monto: 0, medio: "transferencia" }, // fantasma
    { monto: 400, medio: "deposito" },
  ];

  // Saldo cierra en la UI (0 no aporta nada)
  const saldoUi = calcularSaldo(mediosVisibles, totalACobrar);
  assert.equal(saldoUi.saldoOk, true);

  // Pero lo que mandamos al server NO incluye el medio en $0
  const mediosAEnviar = filtrarMediosConMonto(mediosVisibles);
  assert.equal(mediosAEnviar.length, 2);
  // Y la suma final también cierra
  const saldoFinal = calcularSaldo(mediosAEnviar, totalACobrar);
  assert.equal(saldoFinal.saldoOk, true);
});

test("flujo — invariante crítico: monto cobrado === monto enviado al server", () => {
  // Caso real: cajera arma 4 medios, uno queda en $0, el resto cubre el total
  const totalNeto = 25000;
  const totalACobrar = calcularTotalACobrar(totalNeto, true, null); // 27625
  assert.equal(totalACobrar, 27625);

  const mediosUi = [
    { monto: 10000, medio: "efectivo", referencia: "" },
    { monto: 0, medio: "transferencia", referencia: "" },
    { monto: 15000, medio: "deposito", referencia: "abc" },
    { monto: 2625, medio: "efectivo", referencia: "" },
  ];

  const mediosLimpios = filtrarMediosConMonto(mediosUi);
  const sumaEnviada = calcularSumaMedios(mediosLimpios);

  assert.equal(sumaEnviada, totalACobrar);
  // Y el medio fantasma no se cuela en lo enviado
  assert.equal(mediosLimpios.length, 3);
  assert.equal(
    mediosLimpios.every((m) => (m.monto ?? 0) > 0),
    true,
  );
});

test("flujo — toggle de recargo cambia totalACobrar y montoFacturado sincroniza", () => {
  // Caso: cajera activa factura, luego marca el recargo 10,5%.
  // El monto facturado debe pasar de total neto a total con recargo
  // (regla fiscal: con recargo se factura el 100% del total cobrado).
  const totalNeto = 10000;

  // Antes del recargo
  let totalACobrar = calcularTotalACobrar(totalNeto, false, null);
  let montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 100);
  assert.equal(totalACobrar, 10000);
  assert.equal(montoFacturado, 10000);

  // Activa recargo 10,5%
  totalACobrar = calcularTotalACobrar(totalNeto, true, null);
  // El sync automático del modal vuelve a 100% del nuevo total
  montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 100);
  assert.equal(totalACobrar, 11050);
  assert.equal(montoFacturado, 11050);

  // Cambia a recargo manual 15%
  totalACobrar = calcularTotalACobrar(totalNeto, false, 15);
  montoFacturado = calcularMontoPorPorcentaje(totalACobrar, 100);
  assert.equal(totalACobrar, 11500);
  assert.equal(montoFacturado, 11500);
});

test("flujo — descuento extremo (100%) deja totales en 0", () => {
  const subtotal = 5000;
  const descuento = calcularDescuentoAplicado(subtotal, 100);
  const totalNeto = calcularTotalNeto(subtotal, descuento);
  const totalACobrar = calcularTotalACobrar(totalNeto, true, null); // recargo sobre 0

  assert.equal(descuento, 5000);
  assert.equal(totalNeto, 0);
  assert.equal(totalACobrar, 0);

  // Sin medios, saldo cierra en 0
  const saldo = calcularSaldo([], totalACobrar);
  assert.equal(saldo.saldoOk, true);
});

test("flujo — preset facturado tras recargo: detecta correctamente sobre el nuevo total", () => {
  const totalNeto = 1000;
  // Sin recargo, cajera elige facturar 30% → 300
  let totalACobrar = calcularTotalACobrar(totalNeto, false, null);
  let monto = calcularMontoPorPorcentaje(totalACobrar, 30);
  assert.equal(detectarPorcentajeFacturado(monto, totalACobrar), 30);

  // Activa recargo manual 5% → totalACobrar = 1050
  // El monto facturado tiene que pasar a 100% del nuevo total (regla fiscal)
  totalACobrar = calcularTotalACobrar(totalNeto, false, 5);
  monto = calcularMontoPorPorcentaje(totalACobrar, 100);
  assert.equal(totalACobrar, 1050);
  assert.equal(monto, 1050);
  assert.equal(detectarPorcentajeFacturado(monto, totalACobrar), 100);
});

// ============================================================================
// Sanity checks de helpers
// ============================================================================

test("round2 — redondea a 2 decimales", () => {
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(1.235), 1.24);
  assert.equal(round2(0), 0);
  // Quirk conocido de Math.round(x * 100) / 100: 1.005 * 100 da 100.49999…
  // en floating point, así que round2(1.005) === 1, no 1.01. Lo dejamos
  // documentado para que nadie "arregle" el helper rompiendo la regla del
  // banker's rounding por accidente. La tolerancia de ±0.01 en calcularSaldo
  // absorbe esto cuando se compara con totales.
  assert.equal(round2(1.005), 1);
});

test("PORCENTAJES_FACTURADO_PRESET — la constante coincide con UI", () => {
  // Si esto rompe, hay que actualizar también los botones del modal
  assert.deepEqual([...PORCENTAJES_FACTURADO_PRESET], [30, 50, 100]);
});

// ============================================================================
// esMontoFinito — guarda contra NaN/Infinity en inputs del cliente
// ============================================================================
//
// Antes de este helper, los server actions chequeaban `x < 0` o `x <= 0` para
// rechazar montos basura. Eso filtra negativos pero NaN/Infinity escapan
// porque cualquier comparación con NaN da false. Resultado: NaN llegaba al
// RPC de venta y producía totales corruptos. El helper canónico es
// `Number.isFinite()` pero envolvemos en `esMontoFinito` para que el callsite
// quede legible y haya un único punto que testear.

test("esMontoFinito — números finitos positivos", () => {
  assert.equal(esMontoFinito(100), true);
  assert.equal(esMontoFinito(0), true);
  assert.equal(esMontoFinito(0.01), true);
  assert.equal(esMontoFinito(-50), true);
});

test("esMontoFinito — NaN rechaza", () => {
  assert.equal(esMontoFinito(Number.NaN), false);
});

test("esMontoFinito — Infinity y -Infinity rechazan", () => {
  assert.equal(esMontoFinito(Number.POSITIVE_INFINITY), false);
  assert.equal(esMontoFinito(Number.NEGATIVE_INFINITY), false);
});

test("esMontoFinito — string numérica rechaza (no convierte)", () => {
  // Defensa contra payloads que vienen del cliente con números como string.
  // Si pasa un string, queremos que el server tire el error de input, no que
  // intente coercer y enmascare el bug del cliente.
  assert.equal(esMontoFinito("100"), false);
});

test("esMontoFinito — null/undefined/objeto rechazan", () => {
  assert.equal(esMontoFinito(null), false);
  assert.equal(esMontoFinito(undefined), false);
  assert.equal(esMontoFinito({}), false);
  assert.equal(esMontoFinito([]), false);
});

test("esMontoFinito — invariante: NaN nunca pasa el chequeo (regression guard)", () => {
  // El bug original era que `NaN < 0` devuelve false, así que
  // `if (x < 0) return error` dejaba pasar NaN. Este test garantiza que
  // el patrón `!esMontoFinito(x) || x < 0` SÍ rechaza NaN.
  const x = Number.NaN;
  const pasaCheckViejo = !(x < 0); // patrón viejo (buggy)
  const pasaCheckNuevo = !(!esMontoFinito(x) || x < 0); // patrón nuevo
  assert.equal(pasaCheckViejo, true, "el patrón viejo dejaba pasar NaN");
  assert.equal(pasaCheckNuevo, false, "el patrón nuevo bloquea NaN");
});

// ============================================================================
// EDGE CASES — contratos defensivos del módulo
// ============================================================================

test("permitePorcentajeFacturado — agnóstico de los presets de UI", () => {
  // El helper no conoce PORCENTAJES_FACTURADO_PRESET. Cualquier número
  // distinto de 100 sigue la misma regla: bloqueado con cualquier recargo,
  // permitido sin recargo. Si mañana la UI agrega un preset nuevo (75%) o
  // habilita un input custom, el helper sigue siendo correcto sin tocar.
  assert.equal(permitePorcentajeFacturado(7, false, null), true);
  assert.equal(permitePorcentajeFacturado(75, false, null), true);
  assert.equal(permitePorcentajeFacturado(200, false, null), true);
  assert.equal(permitePorcentajeFacturado(99.99, false, null), true);
  // Con cualquier recargo, todo lo que no sea 100 cae
  assert.equal(permitePorcentajeFacturado(7, true, null), false);
  assert.equal(permitePorcentajeFacturado(75, false, 12), false);
  assert.equal(permitePorcentajeFacturado(99.99, true, null), false);
});

test("calcularSaldo — tolerancia es '<' estricto, no '<='", () => {
  // 0.009 < 0.01 → dentro de tolerancia, saldoOk true
  const r1 = calcularSaldo([{ monto: 99.991 }], 100);
  assert.equal(r1.saldoOk, true);

  // Diferencia exactamente 0.01: cae fuera, porque la condición es
  // Math.abs(diff) < TOLERANCIA, no <=. Esto importa para no aceptar
  // ventas con un centavo de descalce.
  const r2 = calcularSaldo([{ monto: 0 }], 0.01);
  assert.equal(r2.diferencia, 0.01);
  assert.equal(r2.saldoOk, false);

  // 0.011 > 0.01 → fuera de tolerancia
  const r3 = calcularSaldo([{ monto: 99.989 }], 100);
  assert.equal(r3.saldoOk, false);
});

test("calcularTotalACobrar — recargo manual fuera de rango NO se clampea", () => {
  // El helper aplica la fórmula tal cual; no valida rango. La validación
  // del rango [0, 100] es responsabilidad del input (RecargoManualForm).
  // Comportamiento matemático predecible y testeado:

  // -10% → total se REDUCE 10% (no es un descuento, es la fórmula directa)
  assert.equal(calcularTotalACobrar(1000, false, -10), 900);

  // 150% → total se multiplica por 2.5
  assert.equal(calcularTotalACobrar(1000, false, 150), 2500);

  // Defensa anotada para mantenimiento: si alguien quiere clampear,
  // agregar la validación EN EL FORM, no acá. El helper es deliberadamente
  // permisivo (separación de concerns).
});

// ============================================================================
// calcularDescuentoDesdeMonto — descuento por monto absoluto
// ============================================================================

test("calcularDescuentoDesdeMonto — null o <= 0 da 0", () => {
  assert.equal(calcularDescuentoDesdeMonto(1000, null), 0);
  assert.equal(calcularDescuentoDesdeMonto(1000, 0), 0);
  assert.equal(calcularDescuentoDesdeMonto(1000, -100), 0);
});

test("calcularDescuentoDesdeMonto — monto valido se devuelve tal cual", () => {
  assert.equal(calcularDescuentoDesdeMonto(1000, 100), 100);
  assert.equal(calcularDescuentoDesdeMonto(1000, 500), 500);
  assert.equal(calcularDescuentoDesdeMonto(1000, 999.99), 999.99);
});

test("calcularDescuentoDesdeMonto — monto > subtotal se clampea al subtotal", () => {
  // No permitir descuentos negativos en el total
  assert.equal(calcularDescuentoDesdeMonto(1000, 1500), 1000);
  assert.equal(calcularDescuentoDesdeMonto(500, 9999), 500);
});

test("calcularDescuentoDesdeMonto — subtotal 0 da 0", () => {
  assert.equal(calcularDescuentoDesdeMonto(0, 100), 0);
});

test("calcularDescuentoDesdeMonto — redondeo a 2 decimales", () => {
  // Si por algun float raro queda 99.999, devolver 100 (round2)
  assert.equal(calcularDescuentoDesdeMonto(1000, 99.999), 100);
});
