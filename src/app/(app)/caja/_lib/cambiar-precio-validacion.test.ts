import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { validarCambiarPrecioInput } from './cambiar-precio-validacion'

const UUID_OK = '11111111-2222-3333-4444-555555555555'

test('UUID inválido es rechazado', () => {
  const r = validarCambiarPrecioInput({
    productoId: 'not-a-uuid',
    precioNuevo: 100,
    razon: '',
  })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'ID de producto inválido')
})

test('Precio negativo es rechazado', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: -10,
    razon: '',
  })
  assert.equal(r.ok, false)
})

test('Precio cero es rechazado', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: 0,
    razon: '',
  })
  assert.equal(r.ok, false)
})

test('Precio NaN es rechazado', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: NaN,
    razon: '',
  })
  assert.equal(r.ok, false)
})

test('Precio Infinity es rechazado', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: Infinity,
    razon: '',
  })
  assert.equal(r.ok, false)
})

test('Razón > 200 chars es rechazada', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: 100,
    razon: 'a'.repeat(201),
  })
  assert.equal(r.ok, false)
  assert.equal(
    r.ok === false && r.error,
    'La razón es demasiado larga (máx 200 caracteres)'
  )
})

test('Razón vacía pasa con razon=null', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: 100,
    razon: '   ',
  })
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.razon, null)
})

test('Input válido con razón pasa y viene trimeada', () => {
  const r = validarCambiarPrecioInput({
    productoId: UUID_OK,
    precioNuevo: 1234.5,
    razon: '  error de carga  ',
  })
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.razon, 'error de carga')
  assert.equal(r.ok === true && r.precioNuevo, 1234.5)
  assert.equal(r.ok === true && r.productoId, UUID_OK)
})
