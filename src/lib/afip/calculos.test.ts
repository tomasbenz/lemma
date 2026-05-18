import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { descomponerFactura } from './calculos'

test('descomponerFactura — invariante neto + iva = total', () => {
  const casos = [10, 100, 1000, 1300, 11050, 50, 9132, 25000]
  for (const total of casos) {
    const { netoGravado, iva } = descomponerFactura(total, 'factura_a')
    assert.equal(
      Math.round((netoGravado + iva) * 100),
      Math.round(total * 100),
      `Invariante violada para total=${total}: neto=${netoGravado} + iva=${iva} ≠ ${total}`,
    )
  }
})

test('descomponerFactura — iva coincide con base * 0.21 ± 0.01 (tolerancia AFIP)', () => {
  const casos = [10, 100, 1000, 1300, 11050, 50, 9132, 25000]
  for (const total of casos) {
    const { netoGravado, iva } = descomponerFactura(total, 'factura_a')
    const ivaCalculadoPorAfip = Math.round(netoGravado * 0.21 * 100) / 100
    // Comparar en centavos enteros: floating point hace que (1.74 - 1.73)
    // dé 0.010000000000000009 y rompa una comparación naive de floats.
    const diffEnCentavos = Math.abs(
      Math.round(iva * 100) - Math.round(ivaCalculadoPorAfip * 100),
    )
    assert.ok(
      diffEnCentavos <= 1,
      `Total ${total}: iva sistema=${iva}, AFIP recalcula=${ivaCalculadoPorAfip}, diff=${diffEnCentavos / 100}`,
    )
  }
})

test('descomponerFactura — factura_c sigue sin descomponer IVA', () => {
  const { netoGravado, iva, total } = descomponerFactura(1000, 'factura_c')
  assert.equal(netoGravado, 1000)
  assert.equal(iva, 0)
  assert.equal(total, 1000)
})

test('descomponerFactura — factura_b descompone igual que factura_a', () => {
  const a = descomponerFactura(11050, 'factura_a')
  const b = descomponerFactura(11050, 'factura_b')
  assert.deepEqual(a, b)
})

test('descomponerFactura — tipo no A/B (ej. factura_c) no descompone', () => {
  // El type TipoFacturaAfip no incluye 'sin_factura' (es estado de venta,
  // no tipo AFIP). factura_c cubre el branch "no descompone".
  const { netoGravado, iva } = descomponerFactura(1000, 'factura_c')
  assert.equal(netoGravado, 1000)
  assert.equal(iva, 0)
})
