import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { formatARS, formatNumber, formatFechaRelativa } from './format'

// ============================================================================
// formatARS
// ============================================================================
//
// Notas sobre comparaciones:
// - Intl en Node depende de ICU; el separador de miles puede ser "." (default
//   en es-AR clásico) o " " en versiones recientes. Por eso comparamos
//   con normalización de no-break-spaces.
// - El símbolo $ va antes con espacio no-break.

function normalizar(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, '')
}

test('formatARS — entero sin decimales', () => {
  const r = formatARS(1500)
  // Algo tipo "$ 1.500" / "$1.500" según ICU
  assert.match(normalizar(r), /^\$1[.,]500$/)
})

test('formatARS — con decimales fijos a 2', () => {
  const r = formatARS(1500.5)
  // "$1.500,50"
  assert.match(normalizar(r), /^\$1[.,]500,50$/)
})

test('formatARS — número grande con separador de miles', () => {
  const r = formatARS(1_234_567.89)
  assert.match(normalizar(r), /^\$1[.,]234[.,]567,89$/)
})

test('formatARS — cero', () => {
  const r = formatARS(0)
  assert.match(normalizar(r), /^\$0$/)
})

test('formatARS — null devuelve $0', () => {
  assert.equal(formatARS(null), '$0')
})

test('formatARS — undefined devuelve $0', () => {
  assert.equal(formatARS(undefined), '$0')
})

test('formatARS — NaN devuelve $0', () => {
  assert.equal(formatARS(Number.NaN), '$0')
})

test('formatARS — negativo se formatea como negativo (no se trata como cero)', () => {
  const r = formatARS(-1500)
  // Documenta que negativos pasan por Intl (sale "-$1.500" o similar).
  assert.notEqual(r, '$0')
  assert.match(normalizar(r), /1[.,]500/)
})

test('formatARS — invariante: redondeo a 2 decimales (no más, no menos)', () => {
  // 1.234 → "$1,23" (truncar a 2)
  const r = formatARS(1.234)
  assert.match(normalizar(r), /^\$1,23$/)
})

// ============================================================================
// formatNumber
// ============================================================================

test('formatNumber — entero con separador de miles', () => {
  const r = formatNumber(1500)
  assert.match(normalizar(r), /^1[.,]500$/)
})

test('formatNumber — entero chico sin separador', () => {
  const r = formatNumber(15)
  assert.equal(r, '15')
})

test('formatNumber — null/undefined/NaN devuelven "0"', () => {
  assert.equal(formatNumber(null), '0')
  assert.equal(formatNumber(undefined), '0')
  assert.equal(formatNumber(Number.NaN), '0')
})

test('formatNumber — número decimal preserva decimales', () => {
  // Intl con locale es-AR usa coma decimal. Esto debe respetarse para que
  // los reportes en pantalla coincidan con el formato que la dueña conoce.
  const r = formatNumber(1500.5)
  assert.match(normalizar(r), /^1[.,]500,5$/)
})

// ============================================================================
// formatFechaRelativa — branches por intervalo
// ============================================================================

test('formatFechaRelativa — hace menos de 1 minuto → "hace instantes"', () => {
  const ahora = new Date()
  // 30 segundos atrás
  const f = new Date(ahora.getTime() - 30_000)
  assert.equal(formatFechaRelativa(f), 'hace instantes')
})

test('formatFechaRelativa — hace 5 minutos', () => {
  const ahora = new Date()
  const f = new Date(ahora.getTime() - 5 * 60_000)
  assert.equal(formatFechaRelativa(f), 'hace 5 min')
})

test('formatFechaRelativa — hace 3 horas', () => {
  const ahora = new Date()
  const f = new Date(ahora.getTime() - 3 * 3_600_000)
  assert.equal(formatFechaRelativa(f), 'hace 3 h')
})

test('formatFechaRelativa — hace 2 días', () => {
  const ahora = new Date()
  const f = new Date(ahora.getTime() - 2 * 86_400_000)
  assert.equal(formatFechaRelativa(f), 'hace 2 d')
})

test('formatFechaRelativa — hace 8 días → fecha absoluta', () => {
  const ahora = new Date()
  const f = new Date(ahora.getTime() - 8 * 86_400_000)
  const r = formatFechaRelativa(f)
  // Formato "20 mar 2025" — al menos debe tener un mes en español (3 letras)
  // y un año de 4 dígitos.
  assert.match(r.toLowerCase(), /\d{1,2}\s.{3,}\s\d{4}/)
  assert.ok(!r.startsWith('hace '))
})

test('formatFechaRelativa — acepta string ISO además de Date', () => {
  const ahora = new Date()
  const isoHaceUnHora = new Date(ahora.getTime() - 3_600_000).toISOString()
  // Algo entre 59 y 61 minutos para evitar flakiness por jitter.
  const r = formatFechaRelativa(isoHaceUnHora)
  // Cae en branch de horas (1h ≥ 60min)
  assert.match(r, /^hace 1 h$/)
})

test('formatFechaRelativa — borde 60 minutos = 1 hora', () => {
  const ahora = new Date()
  // Justo 60 minutos atrás → diffH = 1, cae en "hace 1 h"
  const f = new Date(ahora.getTime() - 60 * 60_000)
  assert.equal(formatFechaRelativa(f), 'hace 1 h')
})

test('formatFechaRelativa — borde 24h = 1 día', () => {
  const ahora = new Date()
  // Justo 24h atrás (con un margen pequeño para evitar que diffH<24 y caiga
  // en horas por jitter). Usar 24h + 10s.
  const f = new Date(ahora.getTime() - (24 * 3_600_000 + 10_000))
  assert.equal(formatFechaRelativa(f), 'hace 1 d')
})

test('formatFechaRelativa — borde 7 días → cae en formato absoluto', () => {
  const ahora = new Date()
  // 7 días + 1 hora atrás → diffDias = 7 → cae en absoluto (< 7 no se cumple).
  const f = new Date(ahora.getTime() - (7 * 86_400_000 + 3_600_000))
  const r = formatFechaRelativa(f)
  assert.ok(!r.startsWith('hace '), `Esperaba fecha absoluta, recibí: ${r}`)
})

test('formatFechaRelativa — fecha del futuro cae en "hace instantes" (diff negativo)', () => {
  // Documentar: con diffMs negativo, todos los Math.floor(...) dan ≤ 0;
  // diffMin < 1 → "hace instantes". Edge case razonable (no rompe la app)
  // pero documentamos para no sorprender más adelante.
  const ahora = new Date()
  const f = new Date(ahora.getTime() + 5_000)
  assert.equal(formatFechaRelativa(f), 'hace instantes')
})
