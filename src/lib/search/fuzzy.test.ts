import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { normalizar, similitudTrigram, coincide, rankear } from './fuzzy'

// ============================================================
// normalizar
// ============================================================

test('normalizar — lowercase', () => {
  assert.equal(normalizar('KANGAROO'), 'kangaroo')
})

test('normalizar — quita tildes', () => {
  assert.equal(normalizar('Librería Ñandú'), 'librerianandu')
})

test('normalizar — elimina espacios múltiples', () => {
  assert.equal(normalizar('Kangaro   o  o'), 'kangarooo')
})

test('normalizar — string vacío / falsy', () => {
  assert.equal(normalizar(''), '')
  assert.equal(normalizar('   '), '')
})

// Casos del fix 019: los espacios se ELIMINAN, no se colapsan, para que
// queries tipeadas con espacios sueltos matcheen la versión continua.
test('normalizar — elimina espacios sueltos (caso abrochadora)', () => {
  assert.equal(normalizar('abro ch a do ra'), 'abrochadora')
})

test('normalizar — palabras con espacios se unen', () => {
  assert.equal(normalizar('Hola Mundo'), 'holamundo')
})

test('normalizar — espacios repetidos entre letras (caso Kangaroo)', () => {
  assert.equal(normalizar('Kangaro o o o o'), 'kangarooooo')
})

// ============================================================
// similitudTrigram
// ============================================================

test('similitudTrigram — idénticos = 1', () => {
  assert.equal(similitudTrigram('kangaroo', 'kangaroo'), 1)
})

test('similitudTrigram — dispares = bajo', () => {
  assert.ok(similitudTrigram('kangaroo', 'xyz') < 0.2)
})

test('similitudTrigram — typo cercano = alto', () => {
  assert.ok(similitudTrigram('kanagroo', 'kangaroo') >= 0.3)
})

// ============================================================
// coincide
// ============================================================

test('coincide — exacto/case (includes)', () => {
  assert.equal(coincide('kangaroo', 'Kangaroo'), true)
})

test('coincide — espacios sobrantes colapsan (caso Samu real)', () => {
  // "Kangaro o o" colapsa a "kangaro o o"; el trigram lo rescata.
  assert.equal(coincide('Kangaro o o o', 'Kangaroo'), true)
})

test('coincide — espacios extremos múltiples (caso reportado)', () => {
  assert.equal(coincide('Kangaro o o o o o o oo o', 'Kangaroo'), true)
})

test('coincide — typo (trigram)', () => {
  assert.equal(coincide('kanagroo', 'Kangaroo'), true)
})

test('coincide — substring corto (smart fallback)', () => {
  assert.equal(coincide('001', '001234'), true)
})

test('coincide — corto que no es substring no matchea', () => {
  assert.equal(coincide('99', '001234'), false)
})

test('coincide — no relacionado NO matchea', () => {
  assert.equal(coincide('xyz', 'Kangaroo'), false)
})

test('coincide — query vacía matchea todo', () => {
  assert.equal(coincide('', 'Kangaroo'), true)
})

// ============================================================
// rankear
// ============================================================

test('rankear — ordena por relevancia, excluye no-match', () => {
  const items = [
    { n: 'Cuaderno Rivadavia' },
    { n: 'Kangaroo lápiz' },
    { n: 'Kangaroo mochila' },
  ]
  const r = rankear(items, 'kangaroo', (i) => i.n)
  assert.equal(r.length, 2)
  assert.ok(r.every((i) => i.n.startsWith('Kangaroo')))
})

test('rankear — query vacía devuelve todo sin reordenar', () => {
  const items = [{ n: 'b' }, { n: 'a' }]
  const r = rankear(items, '', (i) => i.n)
  assert.deepEqual(r, items)
})

test('rankear — typo igual rankea', () => {
  const items = [{ n: 'Kangaroo' }, { n: 'Resma A4' }]
  const r = rankear(items, 'kanagroo', (i) => i.n)
  assert.equal(r[0].n, 'Kangaroo')
})
