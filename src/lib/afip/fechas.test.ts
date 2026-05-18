import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  formatearFechaYYYYMMDD,
  formatearFechaDDMMYYYY,
} from './fechas'

// ============================================================
// Casos clásicos
// ============================================================

test('formatearFechaYYYYMMDD — mediodía AR cualquier día', () => {
  // 15:00 UTC = 12:00 AR del 2026-05-13. Ni siquiera cerca del borde.
  const fecha = new Date('2026-05-13T15:00:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

test('formatearFechaDDMMYYYY — mediodía AR cualquier día', () => {
  const fecha = new Date('2026-05-13T15:00:00Z')
  assert.equal(formatearFechaDDMMYYYY(fecha), '13/05/2026')
})

// ============================================================
// Bordes de día AR — el bug fiscal vive acá
// ============================================================

test('formatearFechaYYYYMMDD — 23:30 AR (cerca de medianoche) sigue siendo el mismo día', () => {
  // 23:30 AR del 13 = 02:30 UTC del 14. AFIP debe recibir el 13.
  const fecha = new Date('2026-05-14T02:30:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

test('formatearFechaDDMMYYYY — 23:30 AR coincide con el día reportado a AFIP', () => {
  // Mismo instante que el test anterior — PDF y AFIP deben mostrar el 13.
  const fecha = new Date('2026-05-14T02:30:00Z')
  assert.equal(formatearFechaDDMMYYYY(fecha), '13/05/2026')
})

test('formatearFechaYYYYMMDD — 00:30 AR del 13/05 (recién pasada medianoche)', () => {
  // 00:30 AR del 13 = 03:30 UTC del 13.
  const fecha = new Date('2026-05-13T03:30:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

test('formatearFechaYYYYMMDD — medianoche AR exacta cuenta como el día nuevo', () => {
  // 00:00 AR del 14 = 03:00 UTC del 14. Pasa al día siguiente.
  const fecha = new Date('2026-05-14T03:00:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260514')
})

test('formatearFechaYYYYMMDD — 23:59:59 AR del 13 todavía es el 13', () => {
  // 23:59:59 AR del 13 = 02:59:59 UTC del 14.
  const fecha = new Date('2026-05-14T02:59:59Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

// ============================================================
// Input con offset distinto al de Argentina — se normaliza
// ============================================================

test('formatearFechaYYYYMMDD — input con offset explícito -03:00 (formato nativo AR)', () => {
  const fecha = new Date('2026-05-13T23:30:00-03:00')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

test('formatearFechaDDMMYYYY — input con offset explícito -03:00', () => {
  const fecha = new Date('2026-05-13T23:30:00-03:00')
  assert.equal(formatearFechaDDMMYYYY(fecha), '13/05/2026')
})

test('formatearFechaYYYYMMDD — input con offset +09:00 (Tokio) se normaliza a AR', () => {
  // 12:00 Tokio = 03:00 UTC = 00:00 AR del mismo día.
  const fecha = new Date('2026-05-13T12:00:00+09:00')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

test('formatearFechaYYYYMMDD — input 00:30 AR del 13 (offset +00:00) cae en el 13', () => {
  const fecha = new Date('2026-05-13T03:30:00+00:00')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260513')
})

// ============================================================
// Último día del mes / cambio de año
// ============================================================

test('formatearFechaYYYYMMDD — 23:30 AR del 31/01 sigue siendo enero', () => {
  // 23:30 AR del 31/01 = 02:30 UTC del 01/02. Debe seguir siendo 31/01.
  const fecha = new Date('2026-02-01T02:30:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20260131')
  assert.equal(formatearFechaDDMMYYYY(fecha), '31/01/2026')
})

test('formatearFechaYYYYMMDD — fin de año: 23:30 AR del 31/12/2025 sigue siendo 2025', () => {
  // 23:30 AR del 31/12/2025 = 02:30 UTC del 01/01/2026.
  const fecha = new Date('2026-01-01T02:30:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20251231')
  assert.equal(formatearFechaDDMMYYYY(fecha), '31/12/2025')
})

test('formatearFechaYYYYMMDD — año bisiesto: 29/02/2028 AR', () => {
  const fecha = new Date('2028-02-29T15:00:00Z')
  assert.equal(formatearFechaYYYYMMDD(fecha), '20280229')
  assert.equal(formatearFechaDDMMYYYY(fecha), '29/02/2028')
})

// ============================================================
// INVARIANTE FISCAL CRÍTICA — los dos formatos describen el mismo día
// ============================================================

test('INVARIANTE — para cualquier Date d, formatearFechaYYYYMMDD y formatearFechaDDMMYYYY describen el MISMO día', () => {
  // Generamos 100 instantes diversos, incluyendo bordes peligrosos.
  const casos = [
    // Bordes de día AR
    new Date('2026-05-14T02:30:00Z'),  // 23:30 AR del 13
    new Date('2026-05-14T03:00:00Z'),  // 00:00 AR del 14 (medianoche)
    new Date('2026-05-13T03:00:00Z'),  // 00:00 AR del 13
    new Date('2026-05-14T02:59:59Z'),  // 23:59:59 AR del 13
    // Cambio de mes
    new Date('2026-02-01T02:30:00Z'),
    new Date('2026-03-01T02:30:00Z'),
    // Cambio de año
    new Date('2026-01-01T02:30:00Z'),
    // Año bisiesto
    new Date('2028-02-29T23:00:00Z'),
    new Date('2028-03-01T02:00:00Z'),
    // Diferentes offsets de input
    new Date('2026-05-13T23:30:00-03:00'),
    new Date('2026-05-13T12:00:00+09:00'),
    new Date('2026-05-13T15:00:00Z'),
  ]
  // Sumar 50 puntos aleatorios a lo largo del 2026 para cobertura amplia
  for (let i = 0; i < 50; i++) {
    casos.push(
      new Date(Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 365 * 24 * 3600 * 1000)),
    )
  }

  for (const fecha of casos) {
    const yyyymmdd = formatearFechaYYYYMMDD(fecha)
    const ddmmyyyy = formatearFechaDDMMYYYY(fecha)
    // Re-formatear el ddmmyyyy a yyyymmdd y comparar
    const [dia, mes, anio] = ddmmyyyy.split('/')
    const reformateado = `${anio}${mes}${dia}`
    assert.equal(
      reformateado,
      yyyymmdd,
      `Inconsistencia para ${fecha.toISOString()}: AFIP=${yyyymmdd} vs PDF=${ddmmyyyy}`,
    )
  }
})
