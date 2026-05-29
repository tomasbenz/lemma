import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  filasAObjetos,
  objetosAFilas,
  construirDiff,
  COLUMNAS_EXPORT,
  type FilaParseada,
} from './excel-productos'
import type { ProductoFilaExport } from '@/lib/queries/productos'
import type { EstadoActualImport } from '../_actions/importar-actualizar'

// ============================================================
// Fixtures
// ============================================================

function filaExport(over: Partial<ProductoFilaExport> = {}): ProductoFilaExport {
  return {
    sku_base: over.sku_base ?? 'BASE-1',
    sku_variante: over.sku_variante ?? 'BASE-1-DEFAULT',
    nombre: over.nombre ?? 'Producto',
    atributos: over.atributos ?? '',
    categoria: over.categoria === undefined ? 'PAPELERIA' : over.categoria,
    precio_neto: over.precio_neto ?? 100,
    stock: over.stock ?? 10,
    activo_producto: over.activo_producto ?? true,
    activa_variante: over.activa_variante ?? true,
    codigo_barras:
      over.codigo_barras === undefined ? '779000111' : over.codigo_barras,
  }
}

/** Fila de Excel ya parseada (objeto con headers como claves). */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  for (const c of COLUMNAS_EXPORT) base[c] = ''
  return {
    ...base,
    sku_base: 'BASE-1',
    sku_variante: 'BASE-1-DEFAULT',
    nombre: 'Producto',
    atributos: '',
    categoria: 'PAPELERIA',
    precio_neto: 100,
    stock: 10,
    activo_producto: 'Sí',
    activa_variante: 'Sí',
    codigo_barras: '779000111',
    ...over,
  }
}

function actual(over: Partial<EstadoActualImport> = {}): EstadoActualImport {
  return {
    sku_variante: over.sku_variante ?? 'BASE-1-DEFAULT',
    sku_base: over.sku_base ?? 'BASE-1',
    nombre: over.nombre ?? 'Producto',
    precio_neto: over.precio_neto ?? 100,
    categoria: over.categoria === undefined ? 'PAPELERIA' : over.categoria,
    activo: over.activo ?? true,
    stock: over.stock ?? 10,
    activa: over.activa ?? true,
    codigo_barras:
      over.codigo_barras === undefined ? '779000111' : over.codigo_barras,
  }
}

// ============================================================
// filasAObjetos
// ============================================================

test('filasAObjetos — 1 objeto por fila, booleanos como Sí/No', () => {
  const objs = filasAObjetos([
    filaExport({ activo_producto: true, activa_variante: false }),
  ])
  assert.equal(objs.length, 1)
  assert.equal(objs[0].activo_producto, 'Sí')
  assert.equal(objs[0].activa_variante, 'No')
})

test('filasAObjetos — categoria/codigo_barras null → string vacío', () => {
  const [o] = filasAObjetos([filaExport({ categoria: null, codigo_barras: null })])
  assert.equal(o.categoria, '')
  assert.equal(o.codigo_barras, '')
})

// ============================================================
// objetosAFilas — errores duros
// ============================================================

test('objetosAFilas — headers faltantes → error', () => {
  const res = objetosAFilas([{ sku_variante: 'X', precio_neto: 1 }])
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.errores[0], /Faltan columnas/)
})

test('objetosAFilas — sku_variante duplicado → error', () => {
  const res = objetosAFilas([row(), row()])
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.errores.some((e) => /duplicado/.test(e)), true)
})

test('objetosAFilas — stock no entero → error', () => {
  const res = objetosAFilas([row({ stock: '5,5' })])
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.errores.some((e) => /stock inválido/.test(e)), true)
})

test('objetosAFilas — precio <= 0 → error', () => {
  const res = objetosAFilas([row({ precio_neto: 0 })])
  assert.equal(res.ok, false)
})

test('objetosAFilas — activo no Sí/No → error', () => {
  const res = objetosAFilas([row({ activo_producto: 'tal vez' })])
  assert.equal(res.ok, false)
})

// ============================================================
// objetosAFilas — parseo OK
// ============================================================

test('objetosAFilas — precio con coma decimal', () => {
  const res = objetosAFilas([row({ precio_neto: '1.234,56' })])
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.filas[0].precio_neto, 1234.56)
})

test('objetosAFilas — precio con punto decimal', () => {
  const res = objetosAFilas([row({ precio_neto: '1234.56' })])
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.filas[0].precio_neto, 1234.56)
})

test('objetosAFilas — Sí/No → boolean', () => {
  const res = objetosAFilas([row({ activo_producto: 'No', activa_variante: 'sí' })])
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.filas[0].activo, false)
    assert.equal(res.filas[0].activa, true)
  }
})

test('objetosAFilas — codigo_barras numérico → string', () => {
  const res = objetosAFilas([row({ codigo_barras: 779000111222 })])
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(typeof res.filas[0].codigo_barras, 'string')
    assert.equal(res.filas[0].codigo_barras, '779000111222')
  }
})

test('objetosAFilas — categoria vacía → null', () => {
  const res = objetosAFilas([row({ categoria: '' })])
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.filas[0].categoria, null)
})

// ============================================================
// objetosAFilas — conflicto product-level
// ============================================================

test('objetosAFilas — conflicto product-level → omite ambas filas del producto', () => {
  const res = objetosAFilas([
    row({ sku_variante: 'BASE-1-A', precio_neto: 100 }),
    row({ sku_variante: 'BASE-1-B', precio_neto: 200 }), // mismo sku_base, precio distinto
  ])
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.filas.length, 0)
    assert.equal(res.omitidos.length, 2)
    assert.match(res.omitidos[0].motivo, /Conflicto/)
  }
})

test('objetosAFilas — mismo producto sin discrepancia product-level → no conflicto', () => {
  const res = objetosAFilas([
    row({ sku_variante: 'BASE-1-A', stock: 5 }),
    row({ sku_variante: 'BASE-1-B', stock: 9 }), // difieren en stock (variant-level), OK
  ])
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.filas.length, 2)
    assert.equal(res.omitidos.length, 0)
  }
})

// ============================================================
// construirDiff
// ============================================================

function parseada(over: Partial<FilaParseada> = {}): FilaParseada {
  return {
    sku_variante: over.sku_variante ?? 'BASE-1-DEFAULT',
    sku_base: over.sku_base ?? 'BASE-1',
    nombre: over.nombre ?? 'Producto',
    precio_neto: over.precio_neto ?? 100,
    categoria: over.categoria === undefined ? 'PAPELERIA' : over.categoria,
    activo: over.activo ?? true,
    stock: over.stock ?? 10,
    activa: over.activa ?? true,
    codigo_barras:
      over.codigo_barras === undefined ? '779000111' : over.codigo_barras,
  }
}

test('construirDiff — solo incluye campos cambiados', () => {
  const { cambios, filas } = construirDiff(
    [parseada({ precio_neto: 150 })], // solo precio cambia
    [actual({ precio_neto: 100 })]
  )
  assert.equal(cambios.length, 1)
  assert.equal(cambios[0].precio_neto, 150)
  assert.equal(cambios[0].stock, undefined)
  assert.equal(cambios[0].categoria, undefined)
  assert.equal(filas[0].omitido, false)
  assert.equal(filas[0].celdas.precio_neto?.cambio, true)
  assert.equal(filas[0].celdas.stock?.cambio, false)
})

test('construirDiff — sin cambios → omitido', () => {
  const { cambios, filas } = construirDiff([parseada()], [actual()])
  assert.equal(cambios.length, 0)
  assert.equal(filas[0].omitido, true)
  assert.equal(filas[0].motivo, 'Sin cambios')
})

test('construirDiff — sku no encontrado → omitido', () => {
  const { cambios, filas } = construirDiff(
    [parseada({ sku_variante: 'NO-EXISTE' })],
    [actual()]
  )
  assert.equal(cambios.length, 0)
  assert.equal(filas[0].omitido, true)
  assert.equal(filas[0].motivo, 'SKU de variante no encontrado')
})

test('construirDiff — categoria a null cuenta como cambio', () => {
  const { cambios } = construirDiff(
    [parseada({ categoria: null })],
    [actual({ categoria: 'PAPELERIA' })]
  )
  assert.equal(cambios.length, 1)
  assert.equal(cambios[0].categoria, null)
})
