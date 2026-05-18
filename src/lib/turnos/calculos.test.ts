import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  validarMonto,
  calcularDiferencia,
  calcularTotalTeorico,
  diferenciaEsCero,
} from './calculos'

// ============================================================================
// validarMonto
// ============================================================================

test('validarMonto — acepta número entero positivo', () => {
  const r = validarMonto(1000, 'Base inicial')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.valor, 1000)
})

test('validarMonto — acepta cero', () => {
  const r = validarMonto(0, 'Base inicial')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.valor, 0)
})

test('validarMonto — rechaza número negativo', () => {
  const r = validarMonto(-100, 'Base inicial')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /negativo/)
})

test('validarMonto — rechaza NaN', () => {
  const r = validarMonto(Number.NaN, 'Total declarado')
  assert.equal(r.ok, false)
})

test('validarMonto — rechaza Infinity', () => {
  const r = validarMonto(Number.POSITIVE_INFINITY, 'Total declarado')
  assert.equal(r.ok, false)
})

test('validarMonto — string vacío rechazado', () => {
  const r = validarMonto('', 'Base inicial')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /obligatorio/)
})

test('validarMonto — string con espacios trim a vacío rechazado', () => {
  const r = validarMonto('   ', 'Total declarado')
  assert.equal(r.ok, false)
})

test('validarMonto — parsea string con coma como separador decimal', () => {
  const r = validarMonto('1500,50', 'Total declarado')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.valor, 1500.5)
})

test('validarMonto — parsea string con punto', () => {
  const r = validarMonto('1500.50', 'Total declarado')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.valor, 1500.5)
})

test('validarMonto — string no numérico rechazado', () => {
  const r = validarMonto('hola', 'Total declarado')
  assert.equal(r.ok, false)
})

test('validarMonto — string negativo rechazado', () => {
  const r = validarMonto('-50', 'Base inicial')
  assert.equal(r.ok, false)
})

test('validarMonto — tipo distinto a number/string rechazado', () => {
  const r = validarMonto({ x: 1 }, 'Base inicial')
  assert.equal(r.ok, false)
})

// ============================================================================
// calcularTotalTeorico
// ============================================================================

test('calcularTotalTeorico — base + efectivo ventas', () => {
  assert.equal(calcularTotalTeorico(1000, 2500.75), 3500.75)
})

test('calcularTotalTeorico — redondea a 2 decimales (floating point)', () => {
  // 0.1 + 0.2 === 0.30000000000000004 → debe quedar 0.3
  assert.equal(calcularTotalTeorico(0.1, 0.2), 0.3)
})

// ============================================================================
// calcularDiferencia
// ============================================================================

test('calcularDiferencia — declarado igual a teórico → 0', () => {
  assert.equal(calcularDiferencia(5000, 5000), 0)
})

test('calcularDiferencia — sobra plata en caja → positiva', () => {
  assert.equal(calcularDiferencia(5100, 5000), 100)
})

test('calcularDiferencia — falta plata → negativa', () => {
  assert.equal(calcularDiferencia(4900, 5000), -100)
})

test('calcularDiferencia — redondea a centavos', () => {
  // 1000.555 - 1000.123 = 0.432 → redondea a 0.43
  assert.equal(calcularDiferencia(1000.555, 1000.123), 0.43)
})

test('calcularDiferencia — coincide con round(declarado - teorico, 2) de Postgres', () => {
  // Casos de uso reales: efectivo en caja con ventas variadas.
  const casos: Array<[number, number, number]> = [
    [10000, 8500, 1500],
    [4999.5, 5000, -0.5],
    [1234.56, 1234.56, 0],
    [100.1 + 100.2, 200.3, 0], // floating point edge
  ]
  for (const [declarado, teorico, esperado] of casos) {
    assert.equal(
      calcularDiferencia(declarado, teorico),
      esperado,
      `declarado=${declarado} teorico=${teorico}`
    )
  }
})

// ============================================================================
// diferenciaEsCero (tolerancia 1 centavo)
// ============================================================================

test('diferenciaEsCero — diferencia exacta 0 → true', () => {
  assert.equal(diferenciaEsCero(0), true)
})

test('diferenciaEsCero — diferencia 0.009 → true (sub-centavo)', () => {
  assert.equal(diferenciaEsCero(0.009), true)
})

test('diferenciaEsCero — diferencia 0.01 → false', () => {
  assert.equal(diferenciaEsCero(0.01), false)
})

test('diferenciaEsCero — diferencia negativa pequeña → true si < 1 cent', () => {
  assert.equal(diferenciaEsCero(-0.005), true)
  assert.equal(diferenciaEsCero(-0.01), false)
})
