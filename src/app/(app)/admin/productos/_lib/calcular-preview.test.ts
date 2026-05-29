import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  calcularPreviewPrecioPct,
  calcularPreviewStock,
} from './calcular-preview'
import type { ProductoPreview } from '@/lib/queries/productos'

// ============================================================
// Helpers de fixtures
// ============================================================

function prod(over: Partial<ProductoPreview> = {}): ProductoPreview {
  return {
    id: over.id ?? 'p1',
    nombre: over.nombre ?? 'Producto',
    precio_neto: over.precio_neto ?? 100,
    track_stock: over.track_stock ?? true,
    variantes: over.variantes ?? [
      { id: 'v1', stock: 10, activa: true, sku_variante: 'SKU-1' },
    ],
  }
}

// ============================================================
// calcularPreviewPrecioPct
// ============================================================

test('precio_pct — subir 10%', () => {
  const [f] = calcularPreviewPrecioPct([prod({ precio_neto: 100 })], 10)
  assert.equal(f.actual, 100)
  assert.equal(f.propuesto, 110)
  assert.equal(f.omitido, false)
})

test('precio_pct — bajar 50% (pct negativo)', () => {
  const [f] = calcularPreviewPrecioPct([prod({ precio_neto: 100 })], -50)
  assert.equal(f.propuesto, 50)
})

test('precio_pct — redondeo a 2 decimales', () => {
  // 99.99 * 1.10 = 109.989 → round2 → 109.99
  const [f] = calcularPreviewPrecioPct([prod({ precio_neto: 99.99 })], 10)
  assert.equal(f.propuesto, 109.99)
})

test('precio_pct — clamp >= 0 con pct -100', () => {
  const [f] = calcularPreviewPrecioPct([prod({ precio_neto: 100 })], -100)
  assert.equal(f.propuesto, 0)
})

test('precio_pct — nunca marca omitidos', () => {
  const filas = calcularPreviewPrecioPct(
    [prod({ id: 'a' }), prod({ id: 'b', precio_neto: 0 })],
    25
  )
  assert.equal(filas.every((f) => f.omitido === false), true)
})

// ============================================================
// calcularPreviewStock
// ============================================================

test('stock — sumar simple', () => {
  const [f] = calcularPreviewStock([prod({})], 'sumar', 5)
  assert.equal(f.actual, 10)
  assert.equal(f.propuesto, 15)
  assert.equal(f.omitido, false)
})

test('stock — restar que quedaría negativo se omite', () => {
  const [f] = calcularPreviewStock(
    [prod({ variantes: [{ id: 'v1', stock: 3, activa: true, sku_variante: 'S' }] })],
    'restar',
    5
  )
  assert.equal(f.omitido, true)
  assert.equal(f.motivoOmision, 'Stock insuficiente (quedaría negativo)')
})

test('stock — fijar valor absoluto', () => {
  const [f] = calcularPreviewStock([prod({})], 'fijar', 20)
  assert.equal(f.propuesto, 20)
  assert.equal(f.omitido, false)
})

test('stock — múltiples variantes activas se omite', () => {
  const [f] = calcularPreviewStock(
    [
      prod({
        variantes: [
          { id: 'v1', stock: 4, activa: true, sku_variante: 'A' },
          { id: 'v2', stock: 6, activa: true, sku_variante: 'B' },
        ],
      }),
    ],
    'sumar',
    5
  )
  assert.equal(f.omitido, true)
  assert.equal(f.motivoOmision, 'Múltiples variantes — ajustá desde el detalle')
  assert.equal(f.actual, 10) // suma informativa de las activas
})

test('stock — sin variantes activas se omite', () => {
  const [f] = calcularPreviewStock(
    [
      prod({
        variantes: [{ id: 'v1', stock: 9, activa: false, sku_variante: 'A' }],
      }),
    ],
    'sumar',
    5
  )
  assert.equal(f.omitido, true)
  assert.equal(f.motivoOmision, 'Sin variantes activas')
})

test('stock — sin track_stock se omite', () => {
  const [f] = calcularPreviewStock([prod({ track_stock: false })], 'sumar', 5)
  assert.equal(f.omitido, true)
  assert.equal(f.motivoOmision, 'Producto sin control de stock')
})

test('stock — fijar en 0 es válido (no omitido)', () => {
  const [f] = calcularPreviewStock([prod({})], 'fijar', 0)
  assert.equal(f.propuesto, 0)
  assert.equal(f.omitido, false)
})
