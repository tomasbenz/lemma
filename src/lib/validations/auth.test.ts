import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { loginSchema } from './auth'

// ============================================================================
// Email
// ============================================================================

test('loginSchema — email válido + password >= 6 chars pasa', () => {
  const r = loginSchema.safeParse({
    email: 'admin@example.com',
    password: '123456',
  })
  assert.equal(r.success, true)
})

test('loginSchema — email se normaliza a lowercase', () => {
  const r = loginSchema.safeParse({
    email: 'ADMIN@EXAMPLE.COM',
    password: 'secret-1',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.email, 'admin@example.com')
})

test('loginSchema — email vacío rechaza', () => {
  const r = loginSchema.safeParse({ email: '', password: '123456' })
  assert.equal(r.success, false)
})

test('loginSchema — email sin @ rechaza', () => {
  const r = loginSchema.safeParse({
    email: 'admin.example.com',
    password: '123456',
  })
  assert.equal(r.success, false)
})

test('loginSchema — email sin TLD rechaza', () => {
  const r = loginSchema.safeParse({
    email: 'admin@example',
    password: '123456',
  })
  assert.equal(r.success, false)
})

// ============================================================================
// Password
// ============================================================================

test('loginSchema — password vacía rechaza', () => {
  const r = loginSchema.safeParse({ email: 'a@b.cd', password: '' })
  assert.equal(r.success, false)
})

test('loginSchema — password 5 chars rechaza (mínimo 6)', () => {
  const r = loginSchema.safeParse({ email: 'a@b.cd', password: '12345' })
  assert.equal(r.success, false)
})

test('loginSchema — password 6 chars pasa (borde inferior)', () => {
  const r = loginSchema.safeParse({ email: 'a@b.cd', password: '123456' })
  assert.equal(r.success, true)
})

test('loginSchema — password con espacios cuenta caracteres tal cual', () => {
  // No hay trim en password → espacios computan. Decisión consciente porque
  // Supabase no trimea passwords del lado servidor.
  const r = loginSchema.safeParse({ email: 'a@b.cd', password: '  123 ' })
  assert.equal(r.success, true)
})

test('loginSchema — campos faltantes rechaza', () => {
  const r = loginSchema.safeParse({ email: 'a@b.cd' })
  assert.equal(r.success, false)
})
