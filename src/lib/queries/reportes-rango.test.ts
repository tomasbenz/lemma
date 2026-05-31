import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { calcularRango } from './reportes-rango'

function esMedianoche(d: Date): boolean {
  return (
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  )
}

test('calcularRango — hoy: desde 00:00 de hoy, hasta >= desde', () => {
  const { desde, hasta } = calcularRango({ periodo: 'hoy' })
  const hoy = new Date()
  assert.equal(desde.getFullYear(), hoy.getFullYear())
  assert.equal(desde.getMonth(), hoy.getMonth())
  assert.equal(desde.getDate(), hoy.getDate())
  assert.ok(esMedianoche(desde))
  assert.ok(hasta.getTime() >= desde.getTime())
})

test('calcularRango — ayer: 00:00 a 23:59 del día anterior', () => {
  const { desde, hasta } = calcularRango({ periodo: 'ayer' })
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  assert.equal(desde.getDate(), ayer.getDate())
  assert.ok(esMedianoche(desde))
  assert.equal(desde.getDate(), hasta.getDate()) // mismo día
  assert.equal(hasta.getHours(), 23)
  assert.equal(hasta.getMinutes(), 59)
})

test('calcularRango — semana_actual: desde es lunes 00:00', () => {
  const { desde, hasta } = calcularRango({ periodo: 'semana_actual' })
  assert.equal(desde.getDay(), 1) // 1 = lunes
  assert.ok(esMedianoche(desde))
  assert.ok(hasta.getTime() >= desde.getTime())
})

test('calcularRango — mes_actual: desde es día 1 00:00 del mes actual', () => {
  const { desde } = calcularRango({ periodo: 'mes_actual' })
  const hoy = new Date()
  assert.equal(desde.getDate(), 1)
  assert.equal(desde.getMonth(), hoy.getMonth())
  assert.equal(desde.getFullYear(), hoy.getFullYear())
  assert.ok(esMedianoche(desde))
})

test('calcularRango — mes_pasado: día 1 a último día del mes anterior', () => {
  const { desde, hasta } = calcularRango({ periodo: 'mes_pasado' })
  const mesPasado = (new Date().getMonth() + 11) % 12
  assert.equal(desde.getDate(), 1)
  assert.equal(desde.getMonth(), mesPasado)
  assert.ok(esMedianoche(desde))
  // hasta es el último día del mismo mes pasado, fin del día
  assert.equal(hasta.getMonth(), mesPasado)
  assert.equal(hasta.getHours(), 23)
  // hasta + 1ms cae en el día 1 del mes siguiente (mes actual)
  const siguiente = new Date(hasta.getTime() + 1)
  assert.equal(siguiente.getDate(), 1)
})

test('calcularRango — anio_actual: 1 de enero 00:00', () => {
  const { desde } = calcularRango({ periodo: 'anio_actual' })
  assert.equal(desde.getMonth(), 0)
  assert.equal(desde.getDate(), 1)
  assert.equal(desde.getFullYear(), new Date().getFullYear())
  assert.ok(esMedianoche(desde))
})

test('calcularRango — personalizado válido usa las fechas dadas', () => {
  const { desde, hasta } = calcularRango({
    periodo: 'personalizado',
    desde: '2025-03-10',
    hasta: '2025-03-20',
  })
  assert.equal(desde.getFullYear(), 2025)
  assert.equal(desde.getMonth(), 2) // marzo (0-based)
  assert.equal(desde.getDate(), 10)
  assert.ok(esMedianoche(desde))
  assert.equal(hasta.getDate(), 20)
  assert.equal(hasta.getHours(), 23)
})

test('calcularRango — personalizado inválido cae a mes_actual', () => {
  const { desde } = calcularRango({
    periodo: 'personalizado',
    desde: 'no-es-fecha',
    hasta: null,
  })
  // mes_actual: día 1 del mes actual
  assert.equal(desde.getDate(), 1)
  assert.equal(desde.getMonth(), new Date().getMonth())
})
