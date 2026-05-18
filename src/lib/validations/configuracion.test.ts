import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { configuracionSchema } from './configuracion'

const base = {
  razon_social: 'Librería Samu',
  cuit: '20-12345678-9',
  condicion_iva: 'IVA Responsable Inscripto',
  punto_venta_default: 1,
  puntos_venta: [1, 2],
  umbral_stock_bajo: 5,
}

// ============================================================================
// Campos requeridos
// ============================================================================

test('configuracionSchema — input mínimo válido pasa', () => {
  const r = configuracionSchema.safeParse({ ...base })
  assert.equal(r.success, true)
})

test('configuracionSchema — razon_social trim y min 2', () => {
  const r1 = configuracionSchema.safeParse({ ...base, razon_social: '  X  ' })
  const r2 = configuracionSchema.safeParse({ ...base, razon_social: '  XX  ' })
  assert.equal(r1.success, false)
  assert.equal(r2.success, true)
  if (r2.success) assert.equal(r2.data.razon_social, 'XX')
})

test('configuracionSchema — condicion_iva obligatoria', () => {
  const r = configuracionSchema.safeParse({ ...base, condicion_iva: '' })
  assert.equal(r.success, false)
})

// ============================================================================
// CUIT — obligatorio en configuración (a diferencia del cliente que es opcional)
// ============================================================================

test('configuracionSchema — cuit ausente rechaza', () => {
  const { cuit: _ignored, ...sinCuit } = base
  const r = configuracionSchema.safeParse(sinCuit)
  assert.equal(r.success, false)
})

test('configuracionSchema — cuit vacío rechaza (no es opcional acá)', () => {
  const r = configuracionSchema.safeParse({ ...base, cuit: '' })
  assert.equal(r.success, false)
})

test('configuracionSchema — cuit 11 dígitos se normaliza con guiones', () => {
  const r = configuracionSchema.safeParse({ ...base, cuit: '20123456789' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, '20-12345678-9')
})

test('configuracionSchema — cuit canónico XX-XXXXXXXX-X pasa tal cual', () => {
  const r = configuracionSchema.safeParse({ ...base, cuit: '27-99999999-0' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.cuit, '27-99999999-0')
})

test('configuracionSchema — cuit con letras rechaza', () => {
  const r = configuracionSchema.safeParse({ ...base, cuit: 'AA-BBBBBBBB-C' })
  assert.equal(r.success, false)
})

// ============================================================================
// puntos_venta + punto_venta_default
// ============================================================================

test('configuracionSchema — puntos_venta vacío rechaza', () => {
  const r = configuracionSchema.safeParse({ ...base, puntos_venta: [] })
  assert.equal(r.success, false)
})

test('configuracionSchema — punto_venta_default min 1, max 9999', () => {
  // Para cada caso aseguramos que el punto esté en puntos_venta (sino el
  // refine cruzado dispararía y enmascararía el chequeo de rango).
  const r1 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 0,
    puntos_venta: [0, 1],
  })
  const r2 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1,
    puntos_venta: [1],
  })
  const r3 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 9999,
    puntos_venta: [9999],
  })
  const r4 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 10_000,
    puntos_venta: [10_000],
  })
  assert.equal(r1.success, false)
  assert.equal(r2.success, true)
  assert.equal(r3.success, true)
  assert.equal(r4.success, false)
})

test('configuracionSchema — punto_venta_default decimal rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1.5,
  })
  assert.equal(r.success, false)
})

test('configuracionSchema — puntos_venta acepta string-numérico (coerce)', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    puntos_venta: ['1', '2'] as never,
  })
  assert.equal(r.success, true)
  if (r.success) assert.deepEqual(r.data.puntos_venta, [1, 2])
})

test('configuracionSchema — puntos_venta cada elemento max 9999 (alineado con AFIP)', () => {
  // AFIP WSFE acepta puntos de venta 1-9999 (4 dígitos). El máximo del array
  // tiene que coincidir con el de punto_venta_default.
  const r9999 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1,
    puntos_venta: [1, 9999],
  })
  const r10000 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1,
    puntos_venta: [1, 10_000],
  })
  assert.equal(r9999.success, true)
  assert.equal(r10000.success, false)
})

test('configuracionSchema — puntos_venta máximo 20 elementos', () => {
  const r1 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1,
    puntos_venta: Array.from({ length: 20 }, (_, i) => i + 1),
  })
  const r2 = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 1,
    puntos_venta: Array.from({ length: 21 }, (_, i) => i + 1),
  })
  assert.equal(r1.success, true)
  assert.equal(r2.success, false)
})

// ============================================================================
// punto_venta_default debe estar incluido en puntos_venta (refine)
// ============================================================================

test('configuracionSchema — punto_venta_default incluido en puntos_venta pasa', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 2,
    puntos_venta: [1, 2, 3],
  })
  assert.equal(r.success, true)
})

test('configuracionSchema — punto_venta_default NO incluido en puntos_venta rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    punto_venta_default: 3,
    puntos_venta: [1, 2],
  })
  assert.equal(r.success, false)
  if (!r.success) {
    const issue = r.error.issues.find((i) =>
      i.path.includes('punto_venta_default')
    )
    assert.ok(issue, 'Esperaba un issue en el path punto_venta_default')
    assert.match(issue!.message, /incluido en los puntos de venta/i)
  }
})

// ============================================================================
// inicio_actividades — fecha YYYY-MM-DD
// ============================================================================

test('configuracionSchema — inicio_actividades válida YYYY-MM-DD', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    inicio_actividades: '2024-01-15',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.inicio_actividades, '2024-01-15')
})

test('configuracionSchema — inicio_actividades formato DD/MM/YYYY rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    inicio_actividades: '15/01/2024',
  })
  assert.equal(r.success, false)
})

test('configuracionSchema — inicio_actividades vacío → null', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    inicio_actividades: '',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.inicio_actividades, null)
})

// ============================================================================
// email
// ============================================================================

test('configuracionSchema — email válido', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    email: 'admin@samu.com.ar',
  })
  assert.equal(r.success, true)
})

test('configuracionSchema — email sin @ rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    email: 'admin.samu.com',
  })
  assert.equal(r.success, false)
})

test('configuracionSchema — email ausente → null', () => {
  const r = configuracionSchema.safeParse({ ...base })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.email, null)
})

// ============================================================================
// umbral_stock_bajo
// ============================================================================

test('configuracionSchema — umbral_stock_bajo coerce desde string', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    umbral_stock_bajo: '10' as never,
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.umbral_stock_bajo, 10)
})

test('configuracionSchema — umbral_stock_bajo negativo rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    umbral_stock_bajo: -1,
  })
  assert.equal(r.success, false)
})

test('configuracionSchema — umbral_stock_bajo decimal rechaza', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    umbral_stock_bajo: 5.5,
  })
  assert.equal(r.success, false)
})

// ============================================================================
// Campos opcionales → null
// ============================================================================

test('configuracionSchema — todos los opcionales vacíos → null', () => {
  const r = configuracionSchema.safeParse({
    ...base,
    ingresos_brutos: '',
    domicilio: '',
    localidad: '',
    provincia: '',
    codigo_postal: '',
    telefono: '',
    email: '',
    web: '',
  })
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.ingresos_brutos, null)
    assert.equal(r.data.domicilio, null)
    assert.equal(r.data.localidad, null)
    assert.equal(r.data.provincia, null)
    assert.equal(r.data.codigo_postal, null)
    assert.equal(r.data.telefono, null)
    assert.equal(r.data.email, null)
    assert.equal(r.data.web, null)
  }
})
