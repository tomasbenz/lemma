import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { MPWebhookBodySchema } from './webhook-schema'

// ============================================================================
// Payment notification (schema strict)
// ============================================================================

test('MPWebhookBodySchema — payment válido pasa', () => {
  const body = {
    id: 12345,
    live_mode: true,
    type: 'payment',
    date_created: '2024-01-10T12:00:00Z',
    user_id: 999,
    api_version: 'v1',
    action: 'payment.created',
    data: { id: 'pmt-uuid' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, true)
})

test('MPWebhookBodySchema — payment con id numérico también pasa', () => {
  const body = {
    id: 1,
    type: 'payment',
    data: { id: 987654321 },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, true)
})

test('MPWebhookBodySchema — payment con id string también pasa', () => {
  const body = {
    id: 'evt-1',
    type: 'payment',
    data: { id: 'pmt-abc' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, true)
})

test('MPWebhookBodySchema — payment con data sin id rechaza', () => {
  // Caso patológico: notificación sin id de pago. No tenemos cómo procesarla.
  const body = {
    id: 1,
    type: 'payment',
    data: {},
  }
  const r = MPWebhookBodySchema.safeParse(body)
  // Como zod intenta payment primero y falla por data.id, cae al genérico.
  // El genérico también exige data.id (passthrough sobre {id}), así que falla.
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — payment con campos extra rechazado por strict', () => {
  // En el schema strict no se permiten propiedades desconocidas en el top
  // ni en data. Si MP agrega un campo nuevo, caería al generic passthrough.
  const body = {
    id: 1,
    type: 'payment',
    data: { id: 'p1' },
    nuevo_campo_no_esperado: 'algo',
  }
  const r = MPWebhookBodySchema.safeParse(body)
  // Como type === 'payment' falla en strict por 'nuevo_campo_no_esperado',
  // zod prueba el generic. El generic acepta passthrough, así que pasa.
  assert.equal(r.success, true)
})

// ============================================================================
// Generic notification (passthrough)
// ============================================================================

test('MPWebhookBodySchema — merchant_order cae en generic y pasa', () => {
  const body = {
    id: 1,
    type: 'merchant_order',
    data: { id: 'mo-1', extra: 'OK' },
    campo_random: 'OK',
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.type, 'merchant_order')
  }
})

test('MPWebhookBodySchema — generic sin data.id rechaza', () => {
  const body = {
    id: 1,
    type: 'cualquier_cosa',
    data: { foo: 'bar' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — generic sin type rechaza', () => {
  const body = {
    id: 1,
    data: { id: 'x' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — sin id top-level rechaza', () => {
  const body = {
    type: 'payment',
    data: { id: 'x' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, false)
})

// ============================================================================
// Tipos limítrofes
// ============================================================================

test('MPWebhookBodySchema — body completamente vacío rechaza', () => {
  const r = MPWebhookBodySchema.safeParse({})
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — body null rechaza', () => {
  const r = MPWebhookBodySchema.safeParse(null)
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — body string rechaza', () => {
  const r = MPWebhookBodySchema.safeParse('payment')
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — data como array rechaza (no es object)', () => {
  const body = {
    id: 1,
    type: 'payment',
    data: ['id1', 'id2'],
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, false)
})

test('MPWebhookBodySchema — type con espacios pasa (es string libre en generic)', () => {
  const body = {
    id: 1,
    type: 'unknown type with spaces',
    data: { id: 'x' },
  }
  const r = MPWebhookBodySchema.safeParse(body)
  assert.equal(r.success, true)
})
