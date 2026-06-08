import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { validarEliminarProductoInput } from './eliminar-producto-validacion'

const UUID_OK = '11111111-2222-3333-4444-555555555555'

test('UUID inválido es rechazado', () => {
  const r = validarEliminarProductoInput({
    productoId: 'not-a-uuid',
    razon: 'motivo válido',
  })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'ID inválido')
})

test('Razón vacía es rechazada', () => {
  const r = validarEliminarProductoInput({ productoId: UUID_OK, razon: '' })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'La razón es obligatoria')
})

test('Razón con solo espacios es rechazada', () => {
  const r = validarEliminarProductoInput({ productoId: UUID_OK, razon: '    ' })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.error, 'La razón es obligatoria')
})

test('Razón > 200 chars es rechazada', () => {
  const r = validarEliminarProductoInput({
    productoId: UUID_OK,
    razon: 'a'.repeat(201),
  })
  assert.equal(r.ok, false)
  assert.equal(
    r.ok === false && r.error,
    'La razón es demasiado larga (máx 200 caracteres)'
  )
})

test('Razón válida pasa y viene trimeada', () => {
  const r = validarEliminarProductoInput({
    productoId: UUID_OK,
    razon: '  cargado por error  ',
  })
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.razon, 'cargado por error')
  assert.equal(r.ok === true && r.productoId, UUID_OK)
})

test('Razón de exactamente 200 chars pasa', () => {
  const r = validarEliminarProductoInput({
    productoId: UUID_OK,
    razon: 'a'.repeat(200),
  })
  assert.equal(r.ok, true)
})
