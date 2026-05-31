import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  redondearPrecio,
  esEstrategiaRedondeo,
  DEFAULT_REDONDEO,
  LABELS_REDONDEO,
} from './redondeo'

// ============================================================================
// none — redondeo a 2 decimales (sin redondeo "comercial")
// ============================================================================

test("redondearPrecio 'none' — redondea a 2 decimales", () => {
  assert.equal(redondearPrecio(1240, 'none'), 1240)
  assert.equal(redondearPrecio(1240.5, 'none'), 1240.5)
  assert.equal(redondearPrecio(1240.555, 'none'), 1240.56)
  assert.equal(redondearPrecio(1240.554, 'none'), 1240.55)
  assert.equal(redondearPrecio(0, 'none'), 0)
})

// ============================================================================
// r10 — al múltiplo de $10 más cercano
// ============================================================================

test("redondearPrecio 'r10' — al $10 más cercano", () => {
  assert.equal(redondearPrecio(1240, 'r10'), 1240) // ya redondeado, sin cambio
  assert.equal(redondearPrecio(1244, 'r10'), 1240)
  assert.equal(redondearPrecio(1245, 'r10'), 1250) // .5 → up
  assert.equal(redondearPrecio(1246, 'r10'), 1250)
  // boundary: 5 / 10 = 0.5 → Math.round(0.5) = 1 → 10
  assert.equal(redondearPrecio(5, 'r10'), 10)
  assert.equal(redondearPrecio(4, 'r10'), 0)
})

// ============================================================================
// r50 — al múltiplo de $50 más cercano
// ============================================================================

test("redondearPrecio 'r50' — al $50 más cercano", () => {
  assert.equal(redondearPrecio(1250, 'r50'), 1250) // ya redondeado
  assert.equal(redondearPrecio(1274, 'r50'), 1250)
  assert.equal(redondearPrecio(1275, 'r50'), 1300) // .5 → up
  assert.equal(redondearPrecio(1230, 'r50'), 1250)
  assert.equal(redondearPrecio(24, 'r50'), 0)
})

// ============================================================================
// r100 — al múltiplo de $100 más cercano (DEFAULT)
// ============================================================================

test("redondearPrecio 'r100' — al $100 más cercano", () => {
  assert.equal(redondearPrecio(1200, 'r100'), 1200) // ya redondeado
  assert.equal(redondearPrecio(1249, 'r100'), 1200)
  assert.equal(redondearPrecio(1250, 'r100'), 1300) // .5 → up
  assert.equal(redondearPrecio(1430, 'r100'), 1400)
  assert.equal(redondearPrecio(9970, 'r100'), 10000)
  // ⚠️ productos baratos pueden quedar en $0 con r100 (riesgo conocido, Fase A
  // lo avisa en el preview). Documentado en docs/feature-aumento-por-categoria.md.
  assert.equal(redondearPrecio(46, 'r100'), 0)
})

// ============================================================================
// Caso de uso real: aumentar y redondear
// ============================================================================

test('redondearPrecio — aumento +15% con r100 (caso marcadores)', () => {
  // $1240 * 1.15 = $1426 → r100 → $1400
  assert.equal(redondearPrecio(1240 * 1.15, 'r100'), 1400)
})

test('redondearPrecio — descuento -10% con r50', () => {
  // $1250 * 0.9 = $1125 → r50 → $1150  (1125/50 = 22.5 → round 23 → 1150)
  assert.equal(redondearPrecio(1250 * 0.9, 'r50'), 1150)
})

// ============================================================================
// Inputs inválidos
// ============================================================================

test('redondearPrecio — lanza con precio inválido', () => {
  assert.throws(() => redondearPrecio(NaN, 'r100'))
  assert.throws(() => redondearPrecio(Infinity, 'r10'))
  assert.throws(() => redondearPrecio(-1, 'none'))
})

// ============================================================================
// Helpers de metadata
// ============================================================================

test('esEstrategiaRedondeo — type guard', () => {
  assert.equal(esEstrategiaRedondeo('none'), true)
  assert.equal(esEstrategiaRedondeo('r10'), true)
  assert.equal(esEstrategiaRedondeo('r50'), true)
  assert.equal(esEstrategiaRedondeo('r100'), true)
  assert.equal(esEstrategiaRedondeo('r1000'), false)
  assert.equal(esEstrategiaRedondeo(''), false)
  assert.equal(esEstrategiaRedondeo(null), false)
  assert.equal(esEstrategiaRedondeo(100), false)
})

test('DEFAULT_REDONDEO es r100 y tiene label', () => {
  assert.equal(DEFAULT_REDONDEO, 'r100')
  assert.equal(LABELS_REDONDEO[DEFAULT_REDONDEO], 'A $100')
})
