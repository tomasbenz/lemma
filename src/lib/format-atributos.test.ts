import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  formatAtributos,
  nombreVariante,
  sufijoSku,
} from './format-atributos'

// ============================================================================
// formatAtributos
// ============================================================================

test('formatAtributos — par clave/valor simple', () => {
  const r = formatAtributos({ color: 'Rojo' })
  assert.equal(r, 'Color: Rojo')
})

test('formatAtributos — múltiples claves se unen con separador default', () => {
  const r = formatAtributos({ color: 'Rojo', talle: 'M' })
  assert.equal(r, 'Color: Rojo · Talle: M')
})

test('formatAtributos — separador personalizado', () => {
  const r = formatAtributos({ color: 'Rojo', talle: 'M' }, ', ')
  assert.equal(r, 'Color: Rojo, Talle: M')
})

test('formatAtributos — mapeo de "tamano" sin tilde a "Tamaño"', () => {
  // Defensa contra usuarias que cargan la clave sin tilde — la UX debe
  // mostrar el label correcto igual.
  const r = formatAtributos({ tamano: 'A4' })
  assert.equal(r, 'Tamaño: A4')
})

test('formatAtributos — mapeo de "presentacion" sin tilde', () => {
  const r = formatAtributos({ presentacion: '250ml' })
  assert.equal(r, 'Presentación: 250ml')
})

test('formatAtributos — clave desconocida hace title-case', () => {
  const r = formatAtributos({ gramaje_especial: '120g' })
  assert.equal(r, 'Gramaje_especial: 120g')
})

test('formatAtributos — clave en mayúsculas se normaliza para el lookup', () => {
  // labelClave hace toLowerCase().trim() para chequear KEY_LABELS, así que
  // "COLOR" debe mapearse igual a "Color".
  const r = formatAtributos({ COLOR: 'Rojo' })
  assert.equal(r, 'Color: Rojo')
})

test('formatAtributos — null/undefined → string vacío', () => {
  assert.equal(formatAtributos(null), '')
  assert.equal(formatAtributos(undefined), '')
})

test('formatAtributos — array (no es objeto plano) → string vacío', () => {
  assert.equal(formatAtributos(['rojo', 'M']), '')
})

test('formatAtributos — number/string (no es objeto) → string vacío', () => {
  assert.equal(formatAtributos(42), '')
  assert.equal(formatAtributos('hola'), '')
})

test('formatAtributos — objeto vacío → string vacío', () => {
  assert.equal(formatAtributos({}), '')
})

test('formatAtributos — valores null/undefined se filtran', () => {
  const r = formatAtributos({ color: 'Rojo', talle: null, formato: undefined })
  assert.equal(r, 'Color: Rojo')
})

test('formatAtributos — valor string vacío se filtra', () => {
  const r = formatAtributos({ color: 'Rojo', talle: '   ' })
  assert.equal(r, 'Color: Rojo')
})

test('formatAtributos — coerce de valor numérico a string', () => {
  // Los valores en producción son string, pero pasar un number no debe
  // romper — debe coercer via String(v).
  const r = formatAtributos({ gramaje: 80 } as unknown)
  assert.equal(r, 'Gramaje: 80')
})

// ============================================================================
// nombreVariante
// ============================================================================

test('nombreVariante — atributos vacíos → "Única"', () => {
  assert.equal(nombreVariante({}), 'Única')
})

test('nombreVariante — null → "Única"', () => {
  assert.equal(nombreVariante(null), 'Única')
})

test('nombreVariante — con atributos delega a formatAtributos', () => {
  assert.equal(nombreVariante({ color: 'Rojo' }), 'Color: Rojo')
})

// ============================================================================
// sufijoSku — determinismo
// ============================================================================

test('sufijoSku — atributos vacíos → "DEFAULT"', () => {
  assert.equal(sufijoSku({}), 'DEFAULT')
})

test('sufijoSku — un atributo simple', () => {
  assert.equal(sufijoSku({ color: 'rojo' }), 'ROJO')
})

test('sufijoSku — múltiples atributos ordenados alfabéticamente por clave', () => {
  // Las claves se ordenan alfabéticamente para que el sufijo sea
  // determinístico independientemente del orden de inserción.
  const a = sufijoSku({ color: 'rojo', talle: 'M' })
  const b = sufijoSku({ talle: 'M', color: 'rojo' })
  assert.equal(a, b)
  assert.equal(a, 'ROJO-M')
})

test('sufijoSku — espacios internos se reemplazan por guion', () => {
  assert.equal(sufijoSku({ color: 'azul marino' }), 'AZUL-MARINO')
})

test('sufijoSku — múltiples espacios se colapsan a un guion', () => {
  assert.equal(sufijoSku({ color: 'azul    marino' }), 'AZUL-MARINO')
})

test('sufijoSku — valor con espacios solo se filtra', () => {
  assert.equal(sufijoSku({ color: '   ' }), 'DEFAULT')
})

test('sufijoSku — valor vacío string se filtra', () => {
  assert.equal(sufijoSku({ color: '', talle: 'M' }), 'M')
})

test('sufijoSku — determinismo cross-call: 3 ejecuciones devuelven mismo string', () => {
  const a = { color: 'verde', talle: 'L', formato: 'A4' }
  const r1 = sufijoSku(a)
  const r2 = sufijoSku(a)
  const r3 = sufijoSku(a)
  assert.equal(r1, r2)
  assert.equal(r2, r3)
  // Las CLAVES se ordenan alfabéticamente (color, formato, talle), no los
  // valores. El sufijo concatena los valores en el orden de las claves
  // ordenadas: verde (color), A4 (formato), L (talle).
  assert.equal(r1, 'VERDE-A4-L')
})

test('sufijoSku — invariante: orden de claves NO afecta resultado', () => {
  const combos = [
    { color: 'rojo', talle: 'M', formato: 'A4' },
    { talle: 'M', formato: 'A4', color: 'rojo' },
    { formato: 'A4', color: 'rojo', talle: 'M' },
  ]
  const resultados = combos.map(sufijoSku)
  for (let i = 1; i < resultados.length; i++) {
    assert.equal(resultados[i], resultados[0])
  }
})

test('sufijoSku — uppercase de valores con minúsculas', () => {
  assert.equal(sufijoSku({ color: 'rojo' }), 'ROJO')
})

test('sufijoSku — valor ya en uppercase queda igual', () => {
  assert.equal(sufijoSku({ color: 'ROJO' }), 'ROJO')
})
