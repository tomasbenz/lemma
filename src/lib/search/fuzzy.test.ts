import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { normalizar, tokenizar, buscar, rankear, coincide } from './fuzzy'

// ============================================================
// normalizar
// ============================================================

test('normalizar — lowercases y remueve tildes', () => {
  assert.equal(normalizar('Lápiz'), 'lapiz')
  assert.equal(normalizar('KANGAROO'), 'kangaroo')
})

test('normalizar — pliega ñ → n (igual que el server y el helper viejo)', () => {
  // NFD descompone ñ en n + tilde combinante, que se remueve. Así "nino"
  // encuentra "NIÑO". Query y texto se normalizan igual → match consistente.
  assert.equal(normalizar('ÑOÑO'), 'nono')
  assert.equal(normalizar('Librería Ñandú'), 'libreria nandu')
})

test('normalizar — buscar "nino" encuentra "NIÑO" (plegado consistente)', () => {
  assert.equal(coincide('nino', 'NIÑO DIBUJO'), true)
  assert.equal(coincide('niño', 'NINO DIBUJO'), true)
})

test('normalizar — trimea extremos pero preserva espacios internos', () => {
  assert.equal(normalizar('  espacios  '), 'espacios')
  assert.equal(normalizar('Hola Mundo'), 'hola mundo')
})

test('normalizar — string vacío / falsy', () => {
  assert.equal(normalizar(''), '')
  assert.equal(normalizar('   '), '')
})

// ============================================================
// tokenizar
// ============================================================

test('tokenizar — splitea por espacios y descarta vacíos', () => {
  assert.deepEqual(tokenizar('lapiz negro'), ['lapiz', 'negro'])
  assert.deepEqual(tokenizar('  Lápiz   Negro  '), ['lapiz', 'negro'])
  assert.deepEqual(tokenizar(''), [])
  assert.deepEqual(tokenizar('   '), [])
})

// ============================================================
// buscar — multi-word substring AND
// ============================================================

// Mock de productos basado en datos típicos del catálogo Samu
const PRODUCTOS = [
  { id: '1', nombre: 'LAPIZ NEGRO ESCOLAR', sku: 'LAP001', marca: 'BIC', categoria: 'Lapices' },
  { id: '2', nombre: 'LAPIZ DE COLOR ROJO', sku: 'LAP002', marca: 'FILGO', categoria: 'Lapices' },
  { id: '3', nombre: 'BOLIGRAFO BIC OPACO AZUL', sku: 'BIC16', marca: 'BIC', categoria: 'Biromes' },
  { id: '4', nombre: 'ABROCHADORA DL 0268', sku: 'ABR001', marca: 'DL', categoria: 'Oficina' },
  { id: '5', nombre: 'GOMA DE BORRAR BLANCA', sku: 'GOM001', marca: 'FABER', categoria: 'Borrado' },
  { id: '6', nombre: 'CARPETA NRO 3 ROJA', sku: 'CAR001', marca: 'AVIO', categoria: 'Carpetas' },
]

const texto = (p: (typeof PRODUCTOS)[0]) =>
  `${p.nombre} ${p.sku} ${p.marca} ${p.categoria}`

test('buscar("LAPIZ") encuentra ambos lápices', () => {
  const r = buscar(PRODUCTOS, 'LAPIZ', texto, (p) => p.nombre)
  assert.equal(r.length, 2)
  assert.ok(r.every((p) => p.nombre.includes('LAPIZ')))
})

test('buscar("BIC") encuentra los 2 productos que tienen BIC en nombre o marca', () => {
  // Producto 1 tiene marca BIC; Producto 3 tiene marca BIC y nombre con BIC.
  const r = buscar(PRODUCTOS, 'BIC', texto, (p) => p.nombre)
  assert.equal(r.length, 2)
})

test('buscar("lapiz negro") encuentra solo el lápiz negro (AND multi-token)', () => {
  const r = buscar(PRODUCTOS, 'lapiz negro', texto, (p) => p.nombre)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, '1')
})

test('buscar — tokens en cualquier orden ("negro lapiz")', () => {
  const r = buscar(PRODUCTOS, 'negro lapiz', texto, (p) => p.nombre)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, '1')
})

test('buscar tolera tildes', () => {
  const r = buscar(PRODUCTOS, 'lápiz', texto, (p) => p.nombre)
  assert.equal(r.length, 2)
})

test('buscar tolera mayúsculas/minúsculas mezcladas', () => {
  const r = buscar(PRODUCTOS, 'BiC', texto, (p) => p.nombre)
  assert.equal(r.length, 2)
})

test('buscar con query vacío devuelve todos', () => {
  const r = buscar(PRODUCTOS, '', texto, (p) => p.nombre)
  assert.equal(r.length, PRODUCTOS.length)
})

test('buscar con query de solo espacios devuelve todos', () => {
  const r = buscar(PRODUCTOS, '   ', texto, (p) => p.nombre)
  assert.equal(r.length, PRODUCTOS.length)
})

test('buscar con query que no matchea nada devuelve []', () => {
  const r = buscar(PRODUCTOS, 'xyzabc', texto, (p) => p.nombre)
  assert.equal(r.length, 0)
})

test('buscar matchea por sku también', () => {
  const r = buscar(PRODUCTOS, 'BIC16', texto, (p) => p.nombre)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, '3')
})

test('buscar matchea por categoría', () => {
  const r = buscar(PRODUCTOS, 'oficina', texto, (p) => p.nombre)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, '4')
})

test('buscar — sku parcial corto matchea por substring', () => {
  // Equivalente al viejo "smart fallback" para SKUs cortos: substring directo.
  const r = buscar(PRODUCTOS, '001', texto)
  assert.ok(r.length >= 1)
  assert.ok(r.some((p) => p.sku === 'LAP001'))
})

test('buscar resultado ordenado por nombre asc cuando se pasa obtenerNombre', () => {
  // 'lapiz' matchea 1 y 2; deben venir alfabéticamente
  const r = buscar(PRODUCTOS, 'lapiz', texto, (p) => p.nombre)
  assert.equal(r[0].nombre, 'LAPIZ DE COLOR ROJO')
  assert.equal(r[1].nombre, 'LAPIZ NEGRO ESCOLAR')
})

test('buscar mantiene orden original cuando obtenerNombre no se provee', () => {
  const r = buscar(PRODUCTOS, 'lapiz', texto)
  assert.equal(r[0].id, '1') // Aparece primero en el array original
  assert.equal(r[1].id, '2')
})

// ============================================================
// Aliases retro-compatibles
// ============================================================

test('rankear es alias de buscar (sin ordenar por nombre)', () => {
  const r = rankear(PRODUCTOS, 'lapiz', texto)
  assert.equal(r.length, 2)
  assert.equal(r[0].id, '1') // mantiene orden original
})

test('rankear — query vacía devuelve todo sin reordenar', () => {
  const items = [{ n: 'b' }, { n: 'a' }]
  const r = rankear(items, '', (i) => i.n)
  assert.deepEqual(r, items)
})

test('coincide chequea si todos los tokens están en texto', () => {
  assert.equal(coincide('lapiz', 'LAPIZ NEGRO ESCOLAR'), true)
  assert.equal(coincide('lapiz negro', 'LAPIZ NEGRO ESCOLAR'), true)
  assert.equal(coincide('lapiz negro', 'LAPIZ ROJO'), false)
  assert.equal(coincide('', 'cualquier cosa'), true)
  assert.equal(coincide('lapiz', 'goma'), false)
})

test('coincide tolera tildes y mayúsculas', () => {
  assert.equal(coincide('LÁPIZ', 'lapiz negro'), true)
  assert.equal(coincide('lapiz', 'LÁPIZ NEGRO'), true)
})

test('coincide — substring corto (SKUs)', () => {
  assert.equal(coincide('001', '001234'), true)
  assert.equal(coincide('99', '001234'), false)
})

test('coincide — no relacionado NO matchea', () => {
  assert.equal(coincide('xyz', 'Kangaroo'), false)
})
