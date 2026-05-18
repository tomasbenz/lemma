import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { clienteSchema } from './cliente'

// Helper: input mínimo válido para poder enfocarnos en un campo a la vez
const base = {
  razon_social: 'Acme SRL',
  cond_iva: 'RI' as const,
}

// ============================================================================
// razon_social
// ============================================================================

test('clienteSchema — razon_social válida', () => {
  const r = clienteSchema.safeParse({ ...base })
  assert.equal(r.success, true)
})

test('clienteSchema — razon_social trim de espacios', () => {
  const r = clienteSchema.safeParse({
    ...base,
    razon_social: '   Acme SRL   ',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.razon_social, 'Acme SRL')
})

test('clienteSchema — razon_social menor a 2 chars falla', () => {
  const r = clienteSchema.safeParse({ ...base, razon_social: 'A' })
  assert.equal(r.success, false)
})

test('clienteSchema — razon_social solo espacios trimea a vacío y falla', () => {
  const r = clienteSchema.safeParse({ ...base, razon_social: '    ' })
  assert.equal(r.success, false)
})

test('clienteSchema — razon_social mayor a 200 chars falla', () => {
  const r = clienteSchema.safeParse({
    ...base,
    razon_social: 'A'.repeat(201),
  })
  assert.equal(r.success, false)
})

// ============================================================================
// cond_iva
// ============================================================================

test('clienteSchema — cond_iva acepta RI/MONO/CF/EX', () => {
  for (const c of ['RI', 'MONO', 'CF', 'EX'] as const) {
    const r = clienteSchema.safeParse({ ...base, cond_iva: c })
    assert.equal(r.success, true, `Falló para ${c}`)
  }
})

test('clienteSchema — cond_iva inválida falla', () => {
  const r = clienteSchema.safeParse({ ...base, cond_iva: 'AA' as never })
  assert.equal(r.success, false)
})

test('clienteSchema — cond_iva faltante falla', () => {
  const { razon_social } = base
  const r = clienteSchema.safeParse({ razon_social })
  assert.equal(r.success, false)
})

// ============================================================================
// CUIT — normalización y validación
// ============================================================================

test('clienteSchema — cuit con guiones (formato canónico) pasa', () => {
  const r = clienteSchema.safeParse({
    ...base,
    cuit: '20-12345678-9',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, '20-12345678-9')
})

test('clienteSchema — cuit 11 dígitos sin guiones se normaliza', () => {
  const r = clienteSchema.safeParse({
    ...base,
    cuit: '20123456789',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, '20-12345678-9')
})

test('clienteSchema — cuit con espacios se trimea y normaliza', () => {
  const r = clienteSchema.safeParse({
    ...base,
    cuit: '  20123456789  ',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, '20-12345678-9')
})

test('clienteSchema — cuit con guion sólo en uno de los dos lugares pasa', () => {
  // El regex permite `\d{2}-?\d{8}-?\d{1}`, así que estos dos formatos pasan.
  const r1 = clienteSchema.safeParse({ ...base, cuit: '20-123456789' })
  const r2 = clienteSchema.safeParse({ ...base, cuit: '2012345678-9' })
  assert.equal(r1.success, true)
  assert.equal(r2.success, true)
  if (r1.success) assert.equal(r1.data.cuit, '20-12345678-9')
  if (r2.success) assert.equal(r2.data.cuit, '20-12345678-9')
})

test('clienteSchema — cuit menos de 11 dígitos falla', () => {
  const r = clienteSchema.safeParse({ ...base, cuit: '201234567' })
  assert.equal(r.success, false)
})

test('clienteSchema — cuit más de 11 dígitos falla', () => {
  const r = clienteSchema.safeParse({ ...base, cuit: '201234567890' })
  assert.equal(r.success, false)
})

test('clienteSchema — cuit con letras falla', () => {
  const r = clienteSchema.safeParse({ ...base, cuit: 'AA12345678B' })
  assert.equal(r.success, false)
})

test('clienteSchema — cuit ausente → null', () => {
  const r = clienteSchema.safeParse({ ...base })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, null)
})

test('clienteSchema — cuit string vacío → null', () => {
  const r = clienteSchema.safeParse({ ...base, cuit: '' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, null)
})

test('clienteSchema — invariante: cuit normalizado siempre matchea XX-XXXXXXXX-X', () => {
  const cuits = [
    '20-12345678-9',
    '27123456789',
    '30-12345678-9',
    '20-99999999-0',
  ]
  for (const c of cuits) {
    const r = clienteSchema.safeParse({ ...base, cuit: c })
    assert.equal(r.success, true, `Falló para ${c}`)
    if (r.success) {
      assert.match(
        r.data.cuit ?? '',
        /^\d{2}-\d{8}-\d{1}$/,
        `cuit normalizado no canónico: ${r.data.cuit}`
      )
    }
  }
})

// ============================================================================
// Email
// ============================================================================

test('clienteSchema — email válido pasa', () => {
  const r = clienteSchema.safeParse({ ...base, email: 'admin@example.com' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.email, 'admin@example.com')
})

test('clienteSchema — email sin @ falla', () => {
  const r = clienteSchema.safeParse({ ...base, email: 'admin.example.com' })
  assert.equal(r.success, false)
})

test('clienteSchema — email sin punto falla', () => {
  const r = clienteSchema.safeParse({ ...base, email: 'admin@example' })
  assert.equal(r.success, false)
})

test('clienteSchema — email con espacios internos falla', () => {
  const r = clienteSchema.safeParse({ ...base, email: 'admin @example.com' })
  assert.equal(r.success, false)
})

test('clienteSchema — email vacío → null', () => {
  const r = clienteSchema.safeParse({ ...base, email: '' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.email, null)
})

test('clienteSchema — email ausente → null', () => {
  const r = clienteSchema.safeParse({ ...base })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.email, null)
})

// ============================================================================
// Campos opcionales con transform → null
// ============================================================================

test('clienteSchema — telefono/domicilio/localidad/provincia/notas vacíos → null', () => {
  const r = clienteSchema.safeParse({
    ...base,
    telefono: '',
    domicilio: '',
    localidad: '',
    provincia: '',
    notas: '',
  })
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.telefono, null)
    assert.equal(r.data.domicilio, null)
    assert.equal(r.data.localidad, null)
    assert.equal(r.data.provincia, null)
    assert.equal(r.data.notas, null)
  }
})

test('clienteSchema — telefono con espacios se trimea', () => {
  const r = clienteSchema.safeParse({ ...base, telefono: '  +54 11 1234  ' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.telefono, '+54 11 1234')
})

test('clienteSchema — notas máximo 1000 chars', () => {
  const r1 = clienteSchema.safeParse({ ...base, notas: 'A'.repeat(1000) })
  const r2 = clienteSchema.safeParse({ ...base, notas: 'A'.repeat(1001) })
  assert.equal(r1.success, true)
  assert.equal(r2.success, false)
})
