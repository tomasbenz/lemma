import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { escaparParaOrFilter } from './_helpers'

// ============================================================================
// escaparParaOrFilter — sanitización para .or() / .filter() de PostgREST
// ============================================================================
//
// Contrato: el resultado se interpola dentro de `%${q}%` en una string
// PostgREST. NUNCA debe contener `,`, `(`, `)` (que reescribirían la
// estructura del filtro) ni `*` / `%` (wildcards de ilike que cambian el
// match esperado).

test('escaparParaOrFilter — string limpia pasa intacta', () => {
  assert.equal(escaparParaOrFilter('libreria samu'), 'libreria samu')
  assert.equal(escaparParaOrFilter('Tomas Benz'), 'Tomas Benz')
})

test('escaparParaOrFilter — input vacío devuelve string vacía', () => {
  assert.equal(escaparParaOrFilter(''), '')
})

test('escaparParaOrFilter — solo espacios devuelve string vacía (trim)', () => {
  assert.equal(escaparParaOrFilter('   '), '')
})

test('escaparParaOrFilter — coma se reemplaza por espacio', () => {
  // La coma es el separador de condiciones en .or(). Si se permite, el
  // atacante puede agregar condiciones extra al filtro.
  const r = escaparParaOrFilter('foo,bar')
  assert.ok(!r.includes(','), `Esperaba sin coma, recibí: ${r}`)
  assert.equal(r, 'foo bar')
})

test('escaparParaOrFilter — paréntesis se reemplazan por espacio', () => {
  // PostgREST usa paréntesis para agrupar condiciones (and(...), or(...)).
  const r = escaparParaOrFilter('foo(bar)')
  assert.ok(!/[()]/.test(r), `Esperaba sin paréntesis, recibí: ${r}`)
  assert.equal(r, 'foo bar')
})

test('escaparParaOrFilter — asterisco se elimina', () => {
  assert.equal(escaparParaOrFilter('*foo*'), 'foo')
  assert.equal(escaparParaOrFilter('***'), '')
})

test('escaparParaOrFilter — porcentaje se elimina (wildcard de ilike)', () => {
  // Si el usuario pone `%`, dentro del wrap `%${q}%` produce un patrón
  // raro que matchea cosas no esperadas. Lo eliminamos para que la
  // búsqueda sea predecible.
  assert.equal(escaparParaOrFilter('100%'), '100')
  assert.equal(escaparParaOrFilter('%foo%bar%'), 'foobar')
})

test('escaparParaOrFilter — combinación de caracteres peligrosos', () => {
  const r = escaparParaOrFilter('foo,*bar(baz)%')
  assert.ok(!/[,()*%]/.test(r), `Quedaron chars peligrosos: ${r}`)
  // foo + espacio (de coma) + bar + espacio (de paréntesis) + baz +
  // espacio (de paréntesis) — trim final, asterisco eliminado.
  assert.equal(r, 'foo bar baz')
})

test('escaparParaOrFilter — intento de inyección de condición OR', () => {
  // Ataque clásico: meter una condición que matchee todo. Si el helper
  // dejaba pasar la coma, podría agregarse algo como
  // `,activo.eq.false` al filtro, reescribiendo la búsqueda.
  const r = escaparParaOrFilter(',activo.eq.false')
  assert.ok(!r.includes(','), `Esperaba sin coma para frenar inyección`)
})

test('escaparParaOrFilter — string SQL-like injection no afecta (caracteres SQL pasan)', () => {
  // `;`, `'`, `--` son inocuos en PostgREST porque .or() construye filtros
  // declarativos, no SQL crudo. Quedan en el resultado pero el wrapper
  // `%${q}%` los hace literales del LIKE. Documentamos eso:
  const r = escaparParaOrFilter("'; DROP TABLE clientes; --")
  assert.equal(r, "'; DROP TABLE clientes; --")
  // El resultado es seguro porque se va a usar como `nombre.ilike.%'; DROP...%`
  // que es un patrón LIKE legítimo, no SQL ejecutable.
})

test('escaparParaOrFilter — invariante: nunca contiene chars peligrosos', () => {
  // Property test sobre varios inputs ofensivos:
  const inputs = [
    'foo',
    'foo,bar',
    'foo(bar)',
    '*foo*',
    '%foo%',
    '),(,(',
    'a,b,c,d,e',
    '',
    '   ',
    '\t\n',
    'cliente normal SA',
    'café con leche',
  ]
  for (const input of inputs) {
    const r = escaparParaOrFilter(input)
    assert.ok(
      !/[,()*%]/.test(r),
      `Falló para "${input}" → "${r}" contiene char peligroso`
    )
    assert.equal(r, r.trim(), `Falló trim para "${input}" → "${r}"`)
  }
})

test('escaparParaOrFilter — preserva caracteres unicode (ñ, acentos)', () => {
  assert.equal(escaparParaOrFilter('Niño Año'), 'Niño Año')
  assert.equal(escaparParaOrFilter('Librería Samu'), 'Librería Samu')
})
