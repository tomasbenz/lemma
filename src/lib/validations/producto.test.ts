import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  atributoSchema,
  varianteSchema,
  productoSchema,
} from './producto'

// Helper: producto mínimo válido para iterar sobre campos sin variantes
const baseProducto = {
  nombre: 'Lápiz HB',
  sku_base: 'LAP-001',
  precio_neto: 100,
  track_stock: true,
  tiene_variantes: false,
}

// ============================================================================
// atributoSchema
// ============================================================================

test('atributoSchema — clave + valor válidos', () => {
  const r = atributoSchema.safeParse({ clave: 'color', valor: 'rojo' })
  assert.equal(r.success, true)
})

test('atributoSchema — clave vacía falla', () => {
  const r = atributoSchema.safeParse({ clave: '', valor: 'rojo' })
  assert.equal(r.success, false)
})

test('atributoSchema — valor vacío falla', () => {
  const r = atributoSchema.safeParse({ clave: 'color', valor: '' })
  assert.equal(r.success, false)
})

test('atributoSchema — clave mayor a 50 chars falla', () => {
  const r = atributoSchema.safeParse({
    clave: 'A'.repeat(51),
    valor: 'rojo',
  })
  assert.equal(r.success, false)
})

test('atributoSchema — valor mayor a 100 chars falla', () => {
  const r = atributoSchema.safeParse({
    clave: 'color',
    valor: 'A'.repeat(101),
  })
  assert.equal(r.success, false)
})

// ============================================================================
// varianteSchema
// ============================================================================

test('varianteSchema — atributos default a []', () => {
  const r = varianteSchema.safeParse({ stock: 10 })
  assert.equal(r.success, true)
  if (r.success) {
    assert.deepEqual(r.data.atributos, [])
    assert.equal(r.data.stock, 10)
  }
})

test('varianteSchema — stock 0 acepta', () => {
  const r = varianteSchema.safeParse({ stock: 0 })
  assert.equal(r.success, true)
})

test('varianteSchema — stock negativo rechaza', () => {
  const r = varianteSchema.safeParse({ stock: -1 })
  assert.equal(r.success, false)
})

test('varianteSchema — stock decimal rechaza (debe ser entero)', () => {
  const r = varianteSchema.safeParse({ stock: 10.5 })
  assert.equal(r.success, false)
})

test('varianteSchema — stock máximo 999999', () => {
  const r1 = varianteSchema.safeParse({ stock: 999999 })
  const r2 = varianteSchema.safeParse({ stock: 1_000_000 })
  assert.equal(r1.success, true)
  assert.equal(r2.success, false)
})

test('varianteSchema — atributos array válido', () => {
  const r = varianteSchema.safeParse({
    atributos: [{ clave: 'color', valor: 'rojo' }],
    stock: 5,
  })
  assert.equal(r.success, true)
})

// ============================================================================
// productoSchema — campos base
// ============================================================================

test('productoSchema — válido pasa', () => {
  const r = productoSchema.safeParse({ ...baseProducto })
  assert.equal(r.success, true)
})

test('productoSchema — nombre mínimo 2 chars', () => {
  const r = productoSchema.safeParse({ ...baseProducto, nombre: 'A' })
  assert.equal(r.success, false)
})

test('productoSchema — nombre máximo 200 chars', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    nombre: 'A'.repeat(201),
  })
  assert.equal(r.success, false)
})

// ============================================================================
// sku_base — regex + transform a uppercase
// ============================================================================

test('productoSchema — sku_base se transforma a uppercase', () => {
  const r = productoSchema.safeParse({ ...baseProducto, sku_base: 'lap-001' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.sku_base, 'LAP-001')
})

test('productoSchema — sku_base con espacios externos: regex falla antes del trim', () => {
  // Detalle de UX: el regex se valida ANTES del transform, así que un input
  // con espacios externos falla por el regex aunque el transform luego
  // hubiera trimeado. Documentamos el comportamiento actual.
  const r = productoSchema.safeParse({
    ...baseProducto,
    sku_base: '  LAP-001  ',
  })
  assert.equal(r.success, false)
})

test('productoSchema — sku_base con caracteres especiales falla', () => {
  for (const sku of ['LAP_001', 'LAP/001', 'LAP.001', 'LAP 001', 'LÁP001']) {
    const r = productoSchema.safeParse({ ...baseProducto, sku_base: sku })
    assert.equal(r.success, false, `Falló para sku ${sku}`)
  }
})

test('productoSchema — sku_base no puede empezar con guion', () => {
  const r = productoSchema.safeParse({ ...baseProducto, sku_base: '-LAP' })
  assert.equal(r.success, false)
})

test('productoSchema — sku_base con sólo dígitos pasa', () => {
  const r = productoSchema.safeParse({ ...baseProducto, sku_base: '12345' })
  assert.equal(r.success, true)
})

test('productoSchema — sku_base máximo 30 chars', () => {
  const r1 = productoSchema.safeParse({
    ...baseProducto,
    sku_base: 'A'.repeat(30),
  })
  const r2 = productoSchema.safeParse({
    ...baseProducto,
    sku_base: 'A'.repeat(31),
  })
  assert.equal(r1.success, true)
  assert.equal(r2.success, false)
})

test('productoSchema — sku_base mínimo 2 chars', () => {
  const r = productoSchema.safeParse({ ...baseProducto, sku_base: 'A' })
  assert.equal(r.success, false)
})

// ============================================================================
// precio_neto
// ============================================================================

test('productoSchema — precio_neto 0 acepta', () => {
  const r = productoSchema.safeParse({ ...baseProducto, precio_neto: 0 })
  assert.equal(r.success, true)
})

test('productoSchema — precio_neto negativo rechaza', () => {
  const r = productoSchema.safeParse({ ...baseProducto, precio_neto: -1 })
  assert.equal(r.success, false)
})

test('productoSchema — precio_neto excede tope', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    precio_neto: 100_000_000,
  })
  assert.equal(r.success, false)
})

test('productoSchema — precio_neto string rechaza (sin coerce)', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    precio_neto: '100' as never,
  })
  assert.equal(r.success, false)
})

// ============================================================================
// imagen_url
// ============================================================================

test('productoSchema — imagen_url válida pasa', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    imagen_url: 'https://cdn.example.com/img.jpg',
  })
  assert.equal(r.success, true)
})

test('productoSchema — imagen_url null pasa', () => {
  const r = productoSchema.safeParse({ ...baseProducto, imagen_url: null })
  assert.equal(r.success, true)
})

test('productoSchema — imagen_url string no-url rechaza', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    imagen_url: 'not a url',
  })
  assert.equal(r.success, false)
})

// ============================================================================
// Refinement tiene_variantes + variantes
// ============================================================================

test('productoSchema — tiene_variantes=true sin variantes rechaza', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    tiene_variantes: true,
    variantes: [],
  })
  assert.equal(r.success, false)
})

test('productoSchema — tiene_variantes=true con 1 variante pasa', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    tiene_variantes: true,
    variantes: [
      { atributos: [{ clave: 'color', valor: 'rojo' }], stock: 5 },
    ],
  })
  assert.equal(r.success, true)
})

test('productoSchema — tiene_variantes=false con variantes vacías pasa', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    tiene_variantes: false,
    variantes: [],
  })
  assert.equal(r.success, true)
})

test('productoSchema — tiene_variantes=false sin pasar variantes (default []) pasa', () => {
  const r = productoSchema.safeParse({ ...baseProducto })
  assert.equal(r.success, true)
  if (r.success) assert.deepEqual(r.data.variantes, [])
})

// ============================================================================
// Campos opcionales: marca_id / categoria_id (FKs) aceptan '' y undefined,
// rechazan strings que no sean uuid. descripcion_corta acepta '' y undefined.
// ============================================================================

const UUID_OK = '11111111-1111-4111-8111-111111111111'

test('productoSchema — marca_id/categoria_id vacíos aceptan', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    marca_id: '',
    categoria_id: '',
  })
  assert.equal(r.success, true)
})

test('productoSchema — marca_id/categoria_id undefined aceptan', () => {
  const r = productoSchema.safeParse({ ...baseProducto })
  assert.equal(r.success, true)
})

test('productoSchema — marca_id uuid válido acepta', () => {
  const r = productoSchema.safeParse({ ...baseProducto, marca_id: UUID_OK })
  assert.equal(r.success, true)
})

test('productoSchema — categoria_id uuid válido acepta', () => {
  const r = productoSchema.safeParse({ ...baseProducto, categoria_id: UUID_OK })
  assert.equal(r.success, true)
})

test('productoSchema — marca_id no-uuid rechaza', () => {
  const r = productoSchema.safeParse({ ...baseProducto, marca_id: 'Kangaro' })
  assert.equal(r.success, false)
})

test('productoSchema — categoria_id no-uuid rechaza', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    categoria_id: 'Cuadernos',
  })
  assert.equal(r.success, false)
})

// ============================================================================
// costo: número >= 0, nullable/opcional
// ============================================================================

test('productoSchema — costo válido acepta', () => {
  const r = productoSchema.safeParse({ ...baseProducto, costo: 50.5 })
  assert.equal(r.success, true)
})

test('productoSchema — costo negativo rechaza', () => {
  const r = productoSchema.safeParse({ ...baseProducto, costo: -5 })
  assert.equal(r.success, false)
})

test('productoSchema — costo null/undefined acepta', () => {
  assert.equal(
    productoSchema.safeParse({ ...baseProducto, costo: null }).success,
    true
  )
  assert.equal(productoSchema.safeParse({ ...baseProducto }).success, true)
})

test('productoSchema — descripcion_corta mayor a 500 chars rechaza', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    descripcion_corta: 'A'.repeat(501),
  })
  assert.equal(r.success, false)
})

// ============================================================================
// track_stock booleano obligatorio
// ============================================================================

test('productoSchema — track_stock no booleano rechaza', () => {
  const r = productoSchema.safeParse({
    ...baseProducto,
    track_stock: 'yes' as never,
  })
  assert.equal(r.success, false)
})

// ============================================================================
// stock_inicial
// ============================================================================

test('productoSchema — stock_inicial default a 0 cuando no se pasa', () => {
  const r = productoSchema.safeParse({ ...baseProducto })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.stock_inicial, 0)
})

test('productoSchema — stock_inicial entero >= 0', () => {
  const r1 = productoSchema.safeParse({ ...baseProducto, stock_inicial: 0 })
  const r2 = productoSchema.safeParse({ ...baseProducto, stock_inicial: -1 })
  const r3 = productoSchema.safeParse({ ...baseProducto, stock_inicial: 1.5 })
  assert.equal(r1.success, true)
  assert.equal(r2.success, false)
  assert.equal(r3.success, false)
})

// ============================================================================
// varianteId — contrato del campo (alta + edición)
// ============================================================================
//
// ⚠️ IMPORTANTE: estos tests NO atrapan el bug original que motivó el fix. El
// bug era del FORM (react-hook-form mandaba '' en vez del uuid porque el hidden
// input no tenía defaultValue), NO del schema — de hecho el schema con un uuid
// válido SIEMPRE pasó. Acá sólo cubrimos el CONTRATO del schema como red de
// seguridad contra regresiones futuras del propio schema (ej: que alguien
// saque el preprocess y vuelva a romper con '' → "Invalid UUID"). Un test real
// del bug necesitaría renderizar el form (RHF), y el repo no tiene infra de
// component tests (jsdom / testing-library).

const VARIANTE_UUID = '05d86415-2b71-43da-9192-0315b613fd71'

function productoConVariantes(
  variantes: Array<Record<string, unknown>>
): Record<string, unknown> {
  return { ...baseProducto, tiene_variantes: true, variantes }
}

test('varianteId — editar variante existente (uuid válido) pasa', () => {
  const r = productoSchema.safeParse(
    productoConVariantes([
      {
        varianteId: VARIANTE_UUID,
        atributos: [{ clave: 'color', valor: 'azul' }],
        stock: 20,
        codigo_barras: '7791234567890',
      },
    ])
  )
  assert.equal(r.success, true)
})

test('varianteId — alta variante nueva (undefined) pasa', () => {
  const r = productoSchema.safeParse(
    productoConVariantes([
      { atributos: [{ clave: 'color', valor: 'azul' }], stock: 5 },
    ])
  )
  assert.equal(r.success, true)
})

test("varianteId — string vacío '' pasa (preprocess '' → undefined)", () => {
  // Es lo que el form mandaba y rompía. El preprocess lo normaliza a undefined.
  const r = productoSchema.safeParse(
    productoConVariantes([
      { varianteId: '', atributos: [{ clave: 'color', valor: 'azul' }], stock: 5 },
    ])
  )
  assert.equal(r.success, true)
  // Y queda como undefined (→ INSERT en el server action), no como ''.
  if (r.success) assert.equal(r.data.variantes[0].varianteId, undefined)
})

test('varianteId — string no-uuid rechaza con path correcto', () => {
  const r = productoSchema.safeParse(
    productoConVariantes([
      { varianteId: 'no-es-uuid', atributos: [], stock: 5 },
    ])
  )
  assert.equal(r.success, false)
  if (!r.success) {
    const paths = r.error.issues.map((i) => i.path.join('.'))
    assert.ok(
      paths.includes('variantes.0.varianteId'),
      `Esperaba error en variantes.0.varianteId, fueron: ${paths.join(', ')}`
    )
  }
})

test('varianteId — mix (una existente con uuid, una nueva sin id) pasa', () => {
  const r = productoSchema.safeParse(
    productoConVariantes([
      {
        varianteId: VARIANTE_UUID,
        atributos: [{ clave: 'color', valor: 'azul' }],
        stock: 20,
      },
      { atributos: [{ clave: 'color', valor: 'rojo' }], stock: 8 },
    ])
  )
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal(r.data.variantes[0].varianteId, VARIANTE_UUID)
    assert.equal(r.data.variantes[1].varianteId, undefined)
  }
})
