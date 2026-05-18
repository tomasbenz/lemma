import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  convertirCaeFchVtoADate,
  traducirResultadoEmision,
  traducirErrorAdaptador,
} from './real'
import { AfipWsfeError } from './wsfe/types'
import type { ResultadoEmisionFactura } from './wsfe/types'

// ============================================================
// convertirCaeFchVtoADate
// ============================================================

test('convertirCaeFchVtoADate — formato yyyymmdd válido', () => {
  assert.equal(convertirCaeFchVtoADate('20260513'), '2026-05-13')
  assert.equal(convertirCaeFchVtoADate('20251231'), '2025-12-31')
  assert.equal(convertirCaeFchVtoADate('20300101'), '2030-01-01')
})

test('convertirCaeFchVtoADate — string vacío → throw', () => {
  assert.throws(() => convertirCaeFchVtoADate(''), /caeFchVto inválido/)
})

test('convertirCaeFchVtoADate — con guiones → throw (no es yyyymmdd)', () => {
  assert.throws(
    () => convertirCaeFchVtoADate('2026-05-13'),
    /caeFchVto inválido/,
  )
})

test('convertirCaeFchVtoADate — menos de 8 dígitos → throw', () => {
  assert.throws(() => convertirCaeFchVtoADate('2026051'), /caeFchVto inválido/)
})

test('convertirCaeFchVtoADate — más de 8 dígitos → throw', () => {
  assert.throws(() => convertirCaeFchVtoADate('202605131'), /caeFchVto inválido/)
})

test('convertirCaeFchVtoADate — caracteres no numéricos → throw', () => {
  assert.throws(() => convertirCaeFchVtoADate('2026May13'), /caeFchVto inválido/)
})

// ============================================================
// traducirResultadoEmision (rama de éxito)
// ============================================================

test('traducirResultadoEmision — éxito sin observaciones', () => {
  const r: ResultadoEmisionFactura = {
    cae: '75123456789012',
    caeFchVto: '20260523',
    cbteNro: 101,
    resultado: 'A',
    observaciones: [],
  }
  const out = traducirResultadoEmision(r)
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.cae, '75123456789012')
    assert.equal(out.caeVencimiento, '2026-05-23')
    assert.equal(out.numeroComprobante, 101)
    assert.equal(out.resultado, 'A')
    assert.equal(out.observaciones, undefined)
  }
})

test('traducirResultadoEmision — éxito con observaciones (warnings) las propaga', () => {
  const r: ResultadoEmisionFactura = {
    cae: '75123456789012',
    caeFchVto: '20260523',
    cbteNro: 101,
    resultado: 'A',
    observaciones: [
      { codigo: 20009, mensaje: 'CUIT cliente con deuda AFIP' },
    ],
  }
  const out = traducirResultadoEmision(r)
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.deepEqual(out.observaciones, [
      { codigo: 20009, mensaje: 'CUIT cliente con deuda AFIP' },
    ])
  }
})

test('traducirResultadoEmision — caeFchVto malformado → propaga throw', () => {
  const r: ResultadoEmisionFactura = {
    cae: '75123456789012',
    caeFchVto: 'INVALIDO',
    cbteNro: 101,
    resultado: 'A',
    observaciones: [],
  }
  assert.throws(() => traducirResultadoEmision(r), /caeFchVto inválido/)
})

// ============================================================
// traducirErrorAdaptador (rama de error)
// ============================================================

test('traducirErrorAdaptador — código catalogado lookups el diccionario interno', () => {
  // IMPORTANTE: traducirErrorAdaptador NO usa los erroresTraducidos del
  // constructor — re-traduce via traducirErrorAfip(codigo, mensajeCrudo).
  // El diccionario en errors.ts mapea 10013 → "Token de acceso vencido".
  const err = new AfipWsfeError(
    'mensaje base',
    {
      metodo: 'FECAESolicitar',
      codigosError: [10013],
      mensajesError: ['Token vencido'],
    },
  )
  const out = traducirErrorAdaptador(err)
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.match(out.error, /Token de acceso vencido/)
    assert.match(out.error, /sistema renovará automáticamente/)
  }
})

test('traducirErrorAdaptador — códigos múltiples unidos con \\n', () => {
  // Re-traduce desde el diccionario: 600 → "CUIT no autorizado",
  // 10016 → "Fecha del comprobante fuera del rango permitido".
  const err = new AfipWsfeError(
    'mensaje base',
    { metodo: 'FECAESolicitar', codigosError: [600, 10016] },
  )
  const out = traducirErrorAdaptador(err)
  if (!out.ok) {
    assert.ok(out.error.includes('\n'), 'Debería unir errores con salto de línea')
    assert.match(out.error, /CUIT no autorizado/)
    assert.match(out.error, /Fecha del comprobante fuera del rango/)
  }
})

test('traducirErrorAdaptador — código NO catalogado preserva mensaje crudo de AFIP', () => {
  const err = new AfipWsfeError(
    'msg',
    {
      metodo: 'FECAESolicitar',
      codigosError: [99999],
      mensajesError: ['Error AFIP cualquiera nuevo'],
    },
  )
  const out = traducirErrorAdaptador(err)
  if (!out.ok) {
    assert.match(out.error, /Error AFIP cualquiera nuevo/)
  }
})

test('traducirErrorAdaptador — AfipWsfeError SIN códigos usa el message', () => {
  const err = new AfipWsfeError(
    'SOAP Fault: timeout',
    { metodo: 'FECAESolicitar' },
  )
  const out = traducirErrorAdaptador(err)
  if (!out.ok) {
    assert.equal(out.error, 'SOAP Fault: timeout')
  }
})

test('traducirErrorAdaptador — AfipWsfeError preserva rawResponse con códigos y severidad', () => {
  const err = new AfipWsfeError(
    'msg',
    { metodo: 'FECAESolicitar', codigosError: [600] },
    [
      {
        codigo: 600,
        mensaje: 'token expirado',
        grupo: 'wsaa-token',
        severidad: 'reintentable',
        esConocido: true,
      },
    ],
  )
  const out = traducirErrorAdaptador(err)
  if (!out.ok) {
    assert.equal((out.rawResponse as { metodo: string }).metodo, 'FECAESolicitar')
    assert.deepEqual((out.rawResponse as { codigosError: number[] }).codigosError, [600])
    assert.equal((out.rawResponse as { severidadMaxima: string }).severidadMaxima, 'reintentable')
  }
})

test('traducirErrorAdaptador — Error genérico (no AfipWsfeError) → message plano', () => {
  const err = new Error('Algo falló feo')
  const out = traducirErrorAdaptador(err)
  if (!out.ok) {
    assert.equal(out.error, 'Algo falló feo')
    assert.equal(out.rawResponse, undefined)
  }
})

test('traducirErrorAdaptador — non-Error (string/object) → mensaje genérico', () => {
  const out = traducirErrorAdaptador('algo raro')
  if (!out.ok) {
    assert.equal(out.error, 'Error desconocido en AFIP')
  }
})
