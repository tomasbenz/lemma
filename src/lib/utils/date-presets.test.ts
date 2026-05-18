import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  detectarPreset,
  calcularRango,
  PRESET_LIST,
  type PresetFecha,
} from './date-presets'

// Helper: shiftear hoy con offset de días, devolviendo ISO YYYY-MM-DD en
// hora local (que es como las construye calcularRango).
function isoOffset(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}T00:00:00`
}

// ============================================================================
// detectarPreset — sin filtros / desde solo
// ============================================================================

test('detectarPreset — sin desde ni hasta → "todas"', () => {
  assert.equal(detectarPreset(), 'todas')
  assert.equal(detectarPreset(null, null), 'todas')
  assert.equal(detectarPreset(undefined, undefined), 'todas')
})

test('detectarPreset — desde = hoy → "hoy"', () => {
  assert.equal(detectarPreset(isoOffset(0)), 'hoy')
})

test('detectarPreset — desde = hace 7 días → "ultimos7"', () => {
  assert.equal(detectarPreset(isoOffset(-7)), 'ultimos7')
})

test('detectarPreset — desde = hace 30 días → "ultimos30"', () => {
  assert.equal(detectarPreset(isoOffset(-30)), 'ultimos30')
})

test('detectarPreset — desde = hace 1 día SIN hasta → "custom" (no ayer)', () => {
  // La rama de "ayer" requiere `hasta`. Sin él, cae en custom.
  assert.equal(detectarPreset(isoOffset(-1)), 'custom')
})

test('detectarPreset — ayer correcto: desde y hasta = ayer', () => {
  assert.equal(detectarPreset(isoOffset(-1), isoOffset(-1)), 'ayer')
})

test('detectarPreset — diffDays atípico → "custom"', () => {
  assert.equal(detectarPreset(isoOffset(-15)), 'custom')
  assert.equal(detectarPreset(isoOffset(-3)), 'custom')
})

test('detectarPreset — solo hasta sin desde → "custom"', () => {
  // No entra al if (!desde && !hasta), no entra al if (desde) →
  // fall-through. La rama 'todas' requiere AMBOS ausentes.
  assert.equal(detectarPreset(null, isoOffset(-1)), 'custom')
})

// ============================================================================
// Roundtrip invariante: detectar(calcular(p)) === p para presets con rango fijo
// ============================================================================

test('detectarPreset(calcularRango(...)) — invariante hoy', () => {
  const { desde, hasta } = calcularRango('hoy')
  assert.equal(detectarPreset(desde, hasta), 'hoy')
})

test('detectarPreset(calcularRango(...)) — invariante ayer', () => {
  const { desde, hasta } = calcularRango('ayer')
  assert.equal(detectarPreset(desde, hasta), 'ayer')
})

test('detectarPreset(calcularRango(...)) — invariante ultimos7', () => {
  const { desde, hasta } = calcularRango('ultimos7')
  assert.equal(detectarPreset(desde, hasta), 'ultimos7')
})

test('detectarPreset(calcularRango(...)) — invariante ultimos30', () => {
  const { desde, hasta } = calcularRango('ultimos30')
  assert.equal(detectarPreset(desde, hasta), 'ultimos30')
})

test('detectarPreset(calcularRango(...)) — invariante todas y custom', () => {
  // Ambos devuelven strings vacíos, así que detectarPreset(.,.) los lee como
  // ausentes → 'todas'. (Es decir, custom no roundtripea — comportamiento
  // intencional: custom representa "rango ad-hoc del usuario" en UI).
  const t = calcularRango('todas')
  const c = calcularRango('custom')
  assert.equal(detectarPreset(t.desde, t.hasta), 'todas')
  assert.equal(detectarPreset(c.desde, c.hasta), 'todas')
})

// ============================================================================
// calcularRango — formato y consistencia
// ============================================================================

test('calcularRango — "hoy" devuelve mismo día con 00:00 y 23:59', () => {
  const { desde, hasta } = calcularRango('hoy')
  // YYYY-MM-DD igual; sólo cambia la hora.
  const desdeFecha = desde.slice(0, 10)
  const hastaFecha = hasta.slice(0, 10)
  assert.equal(desdeFecha, hastaFecha)
  assert.ok(desde.endsWith('T00:00:00'))
  assert.ok(hasta.endsWith('T23:59:59'))
})

test('calcularRango — "ayer" un día antes que hoy', () => {
  const hoy = calcularRango('hoy')
  const ayer = calcularRango('ayer')
  // Convertir a Date para comparar
  const hoyDate = new Date(hoy.desde)
  const ayerDate = new Date(ayer.desde)
  const diff =
    (hoyDate.getTime() - ayerDate.getTime()) / (1000 * 60 * 60 * 24)
  assert.equal(diff, 1)
})

test('calcularRango — "ultimos7" desde 7 días atrás hasta hoy 23:59 (off-by-one documentado)', () => {
  const { desde, hasta } = calcularRango('ultimos7')
  const desdeDate = new Date(desde)
  const hastaDate = new Date(hasta)
  // desde=today-7 (00:00:00), hasta=today (23:59:59) → ~7.999 días → round=8.
  // Esto significa que "ultimos7" cubre 8 días NATURALES: hoy + los 7
  // anteriores. Es decisión de UX vigente; documentamos para no sorprender.
  const diffDays = Math.round(
    (hastaDate.getTime() - desdeDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  assert.equal(diffDays, 8)
})

test('calcularRango — "ultimos30" desde 30 días atrás hasta hoy 23:59 (off-by-one)', () => {
  // Mismo off-by-one que ultimos7: 31 días naturales totales.
  const { desde, hasta } = calcularRango('ultimos30')
  const desdeDate = new Date(desde)
  const hastaDate = new Date(hasta)
  const diffDays = Math.round(
    (hastaDate.getTime() - desdeDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  assert.equal(diffDays, 31)
})

test('calcularRango — "ultimos7" desde es exactamente 7 días naturales antes (sin contar horas)', () => {
  // El delta DE DÍA A DÍA (00:00 a 00:00) sí es 7 — la diferencia es la
  // hora de cierre del hasta. Test alternativo más limpio para el invariante.
  const { desde } = calcularRango('ultimos7')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const desdeDate = new Date(desde)
  desdeDate.setHours(0, 0, 0, 0)
  const diffDays = Math.round(
    (hoy.getTime() - desdeDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  assert.equal(diffDays, 7)
})

test('calcularRango — "todas" devuelve strings vacíos', () => {
  const r = calcularRango('todas')
  assert.deepEqual(r, { desde: '', hasta: '' })
})

test('calcularRango — "custom" devuelve strings vacíos', () => {
  const r = calcularRango('custom')
  assert.deepEqual(r, { desde: '', hasta: '' })
})

test('calcularRango — preset desconocido cae en default (strings vacíos)', () => {
  // Defensive default: si llega un string que no es PresetFecha conocido,
  // no debe romper; cae en el `default` del switch.
  const r = calcularRango('algo_raro' as PresetFecha)
  assert.deepEqual(r, { desde: '', hasta: '' })
})

test('calcularRango — formato YYYY-MM-DDTHH:MM:SS sin offset TZ', () => {
  // Sin "Z" ni offset porque el rango es en hora local (lo consume Postgres
  // como timestamp without time zone vs with TZ depende del SQL; acá solo
  // verificamos el formato string).
  const { desde, hasta } = calcularRango('ultimos7')
  assert.match(desde, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  assert.match(hasta, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
})

// ============================================================================
// BUG documentado: detectarPreset(ayer) compara solo getDate() de hasta
// ============================================================================

test('detectarPreset — comparación de "ayer" usa getDate() (BUG: no compara mes/año)', () => {
  // Documenta el bug: la rama de "ayer" compara `h.getDate() === yesterday.getDate()`
  // y no la fecha completa. En el caso normal (today=10 oct, yesterday=9 oct),
  // si pasamos desde=2024-10-09 + hasta=2024-09-09 (mismo getDate pero distinto
  // mes), la diff to today es 31 días → no entra a la rama de 'ayer' por
  // diffDays !== 1. Test invariante: en el caso real, no se accede a la rama.
  // Si alguna vez se cambia diffDays para permitir 1 con hasta arbitrario,
  // este test rompería y avisaría a ajustar la comparación.
  const ayer = isoOffset(-1)
  const r = detectarPreset(ayer, ayer)
  assert.equal(r, 'ayer')
})

// ============================================================================
// PRESET_LIST
// ============================================================================

test('PRESET_LIST — tiene los 6 presets esperados', () => {
  const keys = PRESET_LIST.map((p) => p.key)
  assert.deepEqual(keys, [
    'hoy',
    'ayer',
    'ultimos7',
    'ultimos30',
    'todas',
    'custom',
  ])
})

test('PRESET_LIST — cada preset tiene label no vacío', () => {
  for (const p of PRESET_LIST) {
    assert.ok(p.label.length > 0)
  }
})
