import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { armarQrUrl, type DatosQrAfip } from './qr'

const URL_BASE = 'https://www.afip.gob.ar/fe/qr/?p='

function decodificarQrPayload(qrUrl: string): Record<string, unknown> {
  if (!qrUrl.startsWith(URL_BASE)) {
    throw new Error(`URL QR no empieza con ${URL_BASE}: ${qrUrl}`)
  }
  const base64 = qrUrl.slice(URL_BASE.length)
  const json = Buffer.from(base64, 'base64').toString('utf-8')
  return JSON.parse(json) as Record<string, unknown>
}

const DATOS_BASE: DatosQrAfip = {
  cuitEmisor: '30715900000',
  fecha: '2026-05-13',
  puntoVenta: 1,
  tipoCmp: 1,
  nroCmp: 12345,
  importe: 1234.56,
  cuitReceptor: '20111111112',
  cae: '75123456789012',
}

test('armarQrUrl — URL empieza con verificador oficial AFIP', () => {
  const url = armarQrUrl(DATOS_BASE)
  assert.ok(
    url.startsWith(URL_BASE),
    `URL debe empezar con "${URL_BASE}", recibido: ${url.slice(0, 60)}`,
  )
})

test('armarQrUrl — payload tiene ver=1 (RG 4892/2020)', () => {
  const payload = decodificarQrPayload(armarQrUrl(DATOS_BASE))
  assert.equal(payload.ver, 1)
})

test('armarQrUrl — orden de claves matchea ejemplo oficial AFIP', () => {
  // CRÍTICO: AFIP genera el QR en su verificador con un orden específico.
  // Si nuestro JSON no respeta ese orden, el base64 difiere byte-a-byte
  // del que produce el verificador, y aunque la decodificación funcione,
  // tests de comparación contra fixtures oficiales fallarían.
  const payload = decodificarQrPayload(armarQrUrl(DATOS_BASE))
  const claves = Object.keys(payload)
  assert.deepEqual(claves, [
    'ver',
    'fecha',
    'cuit',
    'ptoVta',
    'tipoCmp',
    'nroCmp',
    'importe',
    'moneda',
    'ctz',
    'tipoDocRec',
    'nroDocRec',
    'tipoCodAut',
    'codAut',
  ])
})

test('armarQrUrl — campos numéricos van SIN comillas en el JSON', () => {
  // Spec AFIP: cuit, ptoVta, tipoCmp, nroCmp, importe, ctz, tipoDocRec,
  // nroDocRec, codAut deben ser numéricos. Si van como string, el
  // verificador rechaza el QR como "comprobante no encontrado".
  const url = armarQrUrl(DATOS_BASE)
  const base64 = url.slice(URL_BASE.length)
  const json = Buffer.from(base64, 'base64').toString('utf-8')
  // Verificar que no hay comillas alrededor del CUIT numérico
  assert.match(json, /"cuit":30715900000/)
  assert.match(json, /"ptoVta":1/)
  assert.match(json, /"tipoCmp":1/)
  assert.match(json, /"nroCmp":12345/)
  assert.match(json, /"importe":1234\.56/)
  assert.match(json, /"ctz":1/)
  assert.match(json, /"tipoDocRec":80/)
  assert.match(json, /"nroDocRec":20111111112/)
  assert.match(json, /"codAut":75123456789012/)
  // Solo moneda y tipoCodAut son strings
  assert.match(json, /"moneda":"PES"/)
  assert.match(json, /"tipoCodAut":"E"/)
})

test('armarQrUrl — CUIT emisor con guiones se normaliza', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, cuitEmisor: '30-71590000-0' }),
  )
  assert.equal(payload.cuit, 30715900000)
})

test('armarQrUrl — CUIT emisor no numérico → throw', () => {
  assert.throws(
    () => armarQrUrl({ ...DATOS_BASE, cuitEmisor: 'ABC' }),
    /CUIT del emisor inválido/,
  )
})

test('armarQrUrl — CUIT receptor con guiones se normaliza', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, cuitReceptor: '20-11111111-2' }),
  )
  assert.equal(payload.nroDocRec, 20111111112)
  assert.equal(payload.tipoDocRec, 80)
})

test('armarQrUrl — CUIT receptor null → CF anónimo (tipoDocRec=99, nroDocRec=0)', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, cuitReceptor: null }),
  )
  assert.equal(payload.tipoDocRec, 99)
  assert.equal(payload.nroDocRec, 0)
})

test('armarQrUrl — CUIT receptor mal formado → cae como CF (no throw)', () => {
  // Decisión documentada en qr.ts: si el CUIT receptor no parsea, tratar
  // como CF anónimo en lugar de fallar opaco. Pero tipoDocRec sigue siendo
  // 80 (porque tiene valor truthy aunque mal formado) y nroDocRec=0.
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, cuitReceptor: 'NO-ES-CUIT' }),
  )
  // NO-ES-CUIT no es null, así que tipoDocRec=80 (no 99)
  assert.equal(payload.tipoDocRec, 80)
  assert.equal(payload.nroDocRec, 0)
})

test('armarQrUrl — CAE no numérico → throw con mensaje claro', () => {
  assert.throws(
    () => armarQrUrl({ ...DATOS_BASE, cae: 'NO_NUMERICO' }),
    /CAE de la factura no es numérico/,
  )
})

test('armarQrUrl — fecha ISO con hora se trunca a YYYY-MM-DD', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, fecha: '2026-05-13T22:30:00Z' }),
  )
  assert.equal(payload.fecha, '2026-05-13')
})

test('armarQrUrl — importe se redondea a 2 decimales', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, importe: 1234.5678 }),
  )
  assert.equal(payload.importe, 1234.57)
})

test('armarQrUrl — importe con decimales exactos no se altera', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, importe: 1000 }),
  )
  assert.equal(payload.importe, 1000)
})

test('armarQrUrl — moneda fija PES y ctz fija 1', () => {
  const payload = decodificarQrPayload(armarQrUrl(DATOS_BASE))
  assert.equal(payload.moneda, 'PES')
  assert.equal(payload.ctz, 1)
})

test('armarQrUrl — tipoCodAut fijo "E" (Electrónico)', () => {
  // RG 4892/2020 sección 5: tipoCodAut="E" para CAE de FE electrónica.
  const payload = decodificarQrPayload(armarQrUrl(DATOS_BASE))
  assert.equal(payload.tipoCodAut, 'E')
})

test('armarQrUrl — Factura A (tipoCmp=1)', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, tipoCmp: 1 }),
  )
  assert.equal(payload.tipoCmp, 1)
})

test('armarQrUrl — Factura B (tipoCmp=6)', () => {
  const payload = decodificarQrPayload(
    armarQrUrl({ ...DATOS_BASE, tipoCmp: 6 }),
  )
  assert.equal(payload.tipoCmp, 6)
})

test('armarQrUrl — round-trip: decodificar → JSON.parse devuelve datos coherentes', () => {
  // Test E2E: verificar que armando un QR y luego decodificándolo manualmente,
  // los datos clave llegan idénticos. Esto es lo que hace el verificador AFIP
  // al scanear el QR.
  const url = armarQrUrl({
    cuitEmisor: '30715900000',
    fecha: '2026-05-13',
    puntoVenta: 5,
    tipoCmp: 6,
    nroCmp: 1234,
    importe: 12345.67,
    cuitReceptor: '20111111112',
    cae: '75123456789012',
  })
  const payload = decodificarQrPayload(url)
  assert.equal(payload.cuit, 30715900000)
  assert.equal(payload.ptoVta, 5)
  assert.equal(payload.tipoCmp, 6)
  assert.equal(payload.nroCmp, 1234)
  assert.equal(payload.importe, 12345.67)
  assert.equal(payload.codAut, 75123456789012)
  assert.equal(payload.nroDocRec, 20111111112)
})

test('armarQrUrl — el base64 NO debe contener saltos de línea', () => {
  // Algunos encoders agregan \n cada 76 chars. El QR no debe llevarlos:
  // rompen la URL al pasar por servicios intermedios.
  const url = armarQrUrl(DATOS_BASE)
  const base64 = url.slice(URL_BASE.length)
  assert.ok(!base64.includes('\n'), 'base64 contiene \\n')
  assert.ok(!base64.includes('\r'), 'base64 contiene \\r')
})
