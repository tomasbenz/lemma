import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { detectarErrorUniqueConstraint } from './postgres-errors'

// ============================================================
// Detección positiva
// ============================================================

test('detectarErrorUniqueConstraint — PostgrestError shape clásico (code=23505)', () => {
  const err = {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "idx_facturas_afip_una_aprobada_por_venta"',
    details: 'Key (venta_id)=(abc-123) already exists.',
    hint: '',
  }
  assert.equal(detectarErrorUniqueConstraint(err), true)
})

test('detectarErrorUniqueConstraint — code anidado en error.cause', () => {
  // Algunos wrappers (PostgreSQL native driver, undici) ponen el código
  // adentro de `.cause` en lugar de en el error raíz.
  const err = {
    message: 'database error',
    cause: { code: '23505' },
  }
  assert.equal(detectarErrorUniqueConstraint(err), true)
})

test('detectarErrorUniqueConstraint — code presente en raíz aunque haya cause sin code', () => {
  const err = {
    code: '23505',
    cause: { otraCosa: 'irrelevante' },
  }
  assert.equal(detectarErrorUniqueConstraint(err), true)
})

// ============================================================
// Detección negativa
// ============================================================

test('detectarErrorUniqueConstraint — otro SQLSTATE no matchea', () => {
  // 23503 = foreign_key_violation, NO es la que queremos manejar acá.
  const err = { code: '23503', message: 'fk violation' }
  assert.equal(detectarErrorUniqueConstraint(err), false)
})

test('detectarErrorUniqueConstraint — code numérico (no string) no matchea', () => {
  // Postgres siempre serializa el code como string. Si llega number,
  // es un bug de runtime — no lo tratamos como unique.
  const err = { code: 23505 }
  assert.equal(detectarErrorUniqueConstraint(err), false)
})

test('detectarErrorUniqueConstraint — null → false', () => {
  assert.equal(detectarErrorUniqueConstraint(null), false)
})

test('detectarErrorUniqueConstraint — undefined → false', () => {
  assert.equal(detectarErrorUniqueConstraint(undefined), false)
})

test('detectarErrorUniqueConstraint — string crudo → false', () => {
  // Algunos errores se loguean como string. No deberían matchear: el
  // helper trabaja con shapes estructurados.
  assert.equal(detectarErrorUniqueConstraint('23505'), false)
})

test('detectarErrorUniqueConstraint — Error genérico sin code → false', () => {
  const err = new Error('something failed')
  assert.equal(detectarErrorUniqueConstraint(err), false)
})

test('detectarErrorUniqueConstraint — objeto vacío → false', () => {
  assert.equal(detectarErrorUniqueConstraint({}), false)
})

test('detectarErrorUniqueConstraint — cause null no rompe', () => {
  const err = { message: 'algo', cause: null }
  assert.equal(detectarErrorUniqueConstraint(err), false)
})
