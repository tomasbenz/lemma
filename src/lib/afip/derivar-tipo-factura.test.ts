// src/lib/afip/derivar-tipo-factura.test.ts
//
// Tests unitarios de la derivacion pura de tipo de factura.
// Cubre los casos a/b/c/d del PR de "factura derivada automaticamente".
//
// Correr: npm test
//
// El caso (e) del PR (NC + UI + CAE persistido) NO se automatiza aca:
// requiere AFIP sandbox + DB de test + browser automation. Hay un
// checklist manual al final del PR.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivarTipoFactura } from './derivar-tipo-factura'

// =============================================================
// Caso (a) — Cliente RI con CUIT valido → factura_a
// =============================================================
test('(a) RI con CUIT 11 digitos sin guiones → factura_a', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: '20123456789' },
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_a' })
})

test('(a) RI con CUIT con guiones se normaliza → factura_a', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: '20-12345678-9' },
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_a' })
})

// =============================================================
// Caso (b) — Cliente CF / MONO / EX → factura_b
// =============================================================
test('(b) cliente CF → factura_b', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'CF', cuit: null },
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_b' })
})

test('(b) cliente MONO → factura_b (aunque tenga CUIT)', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'MONO', cuit: '20111111111' },
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_b' })
})

test('(b) cliente EX → factura_b', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'EX', cuit: null },
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_b' })
})

// =============================================================
// Caso (c) — Sin cliente → factura_b (CF anonimo)
// =============================================================
test('(c) sin cliente seleccionado → factura_b', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: null,
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_b' })
})

test('(c) cliente null por RLS / borrado entre seleccion y submit → factura_b', () => {
  // Mismo handling que "sin cliente": el caller pasa null si el lookup
  // devolvio null, y la derivacion cae a CF anonimo.
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: null,
  })
  assert.deepEqual(r, { ok: true, tipo: 'factura_b' })
})

// =============================================================
// Caso (d) — Cliente RI sin CUIT valido → error ri_sin_cuit
// =============================================================
test('(d) RI con CUIT null → error ri_sin_cuit', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: null },
  })
  assert.deepEqual(r, { ok: false, reason: 'ri_sin_cuit' })
})

test('(d) RI con CUIT vacio → error ri_sin_cuit', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: '' },
  })
  assert.deepEqual(r, { ok: false, reason: 'ri_sin_cuit' })
})

test('(d) RI con CUIT corto (menos de 11 digitos) → error ri_sin_cuit', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: '12345' },
  })
  assert.deepEqual(r, { ok: false, reason: 'ri_sin_cuit' })
})

test('(d) RI con CUIT largo (mas de 11 digitos sin guiones) → error ri_sin_cuit', () => {
  // 12 digitos despues de quitar guiones — sigue siendo invalido.
  const r = derivarTipoFactura({
    tipoFactura: 'con_factura',
    cliente: { cond_iva: 'RI', cuit: '201234567890' },
  })
  assert.deepEqual(r, { ok: false, reason: 'ri_sin_cuit' })
})

// =============================================================
// Caso adicional — tipoFactura sin_factura corta antes de mirar cliente
// =============================================================
test('sin_factura → siempre sin_factura, ignora cliente', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'sin_factura',
    cliente: { cond_iva: 'RI', cuit: null },
  })
  assert.deepEqual(r, { ok: true, tipo: 'sin_factura' })
})

test('sin_factura sin cliente → sin_factura', () => {
  const r = derivarTipoFactura({
    tipoFactura: 'sin_factura',
    cliente: null,
  })
  assert.deepEqual(r, { ok: true, tipo: 'sin_factura' })
})
