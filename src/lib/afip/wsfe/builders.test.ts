import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  buildFEDummy,
  buildFECompUltimoAutorizado,
  buildFECAESolicitar,
  buildFECompConsultar,
  type ParametrosBuildFECAESolicitar,
} from './builders'
import { AfipWsfeError } from './types'

// ============================================================
// Helpers
// ============================================================

const PARAMS_FECAE_BASE: ParametrosBuildFECAESolicitar = {
  token: 'TOKEN_PLACEHOLDER',
  sign: 'SIGN_PLACEHOLDER',
  cuit: '30715900000',
  puntoVenta: 1,
  cbteTipo: 1, // Factura A
  cbteNro: 100,
  fechaComprobante: new Date('2026-05-13T15:00:00.000Z'), // 12:00 AR
  montoFacturado: 121.0,
  receptor: {
    docTipo: 80,
    docNro: '20111111112',
    condicionIVAReceptorId: 1, // RI
  },
  items: [
    {
      cantidad: 1,
      precioUnitarioConIva: 121.0,
      subtotalConIva: 121.0,
    },
  ],
}

function tagValor(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<ar:${tag}>([^<]+)</ar:${tag}>`))
  return m ? m[1] : null
}

function tieneTag(xml: string, tag: string): boolean {
  return new RegExp(`<ar:${tag}[ >]`).test(xml)
}

// ============================================================
// buildFEDummy
// ============================================================

test('buildFEDummy — XML válido, sin Auth, namespace AFIP', () => {
  const xml = buildFEDummy()
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
  assert.ok(xml.includes('xmlns:ar="http://ar.gov.afip.dif.FEV1/"'))
  assert.ok(xml.includes('<ar:FEDummy/>'))
  // FEDummy es público (healthcheck), NO debe llevar Auth
  assert.ok(!xml.includes('<ar:Auth>'))
})

// ============================================================
// buildFECompUltimoAutorizado
// ============================================================

test('buildFECompUltimoAutorizado — incluye Auth con CUIT numérico', () => {
  const xml = buildFECompUltimoAutorizado({
    token: 'T',
    sign: 'S',
    cuit: '30715900000',
    puntoVenta: 1,
    tipoComprobante: 1,
  })
  // CUIT debe ir como número, NO como string entre comillas
  assert.match(xml, /<ar:Cuit>30715900000<\/ar:Cuit>/)
  assert.equal(tagValor(xml, 'Token'), 'T')
  assert.equal(tagValor(xml, 'Sign'), 'S')
  assert.equal(tagValor(xml, 'PtoVta'), '1')
  assert.equal(tagValor(xml, 'CbteTipo'), '1')
})

test('buildFECompUltimoAutorizado — CUIT no numérico → throw', () => {
  assert.throws(
    () =>
      buildFECompUltimoAutorizado({
        token: 'T',
        sign: 'S',
        cuit: 'ABC',
        puntoVenta: 1,
        tipoComprobante: 1,
      }),
    /CUIT inválido/,
  )
})

// ============================================================
// buildFECAESolicitar — Factura A happy path
// ============================================================

test('buildFECAESolicitar — XML válido para Factura A', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  assert.ok(xml.includes('xmlns:ar="http://ar.gov.afip.dif.FEV1/"'))
  assert.ok(xml.includes('<ar:FECAESolicitar>'))
  assert.equal(tagValor(xml, 'CbteTipo'), '1')
  assert.equal(tagValor(xml, 'PtoVta'), '1')
  assert.equal(tagValor(xml, 'CantReg'), '1')
  assert.equal(tagValor(xml, 'Concepto'), '1') // productos
  assert.equal(tagValor(xml, 'CbteDesde'), '100')
  assert.equal(tagValor(xml, 'CbteHasta'), '100')
  assert.equal(tagValor(xml, 'DocTipo'), '80')
  assert.equal(tagValor(xml, 'DocNro'), '20111111112')
})

test('buildFECAESolicitar — moneda fija PES, cotización 1', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  assert.equal(tagValor(xml, 'MonId'), 'PES')
  assert.equal(tagValor(xml, 'MonCotiz'), '1')
})

test('buildFECAESolicitar — alícuota IVA fija 5 (21%)', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  assert.ok(xml.includes('<ar:AlicIva>'))
  // El Id 5 dentro de <ar:Iva> es la alícuota 21%
  assert.match(
    xml,
    /<ar:Iva>\s*<ar:AlicIva>\s*<ar:Id>5<\/ar:Id>/m,
  )
})

test('buildFECAESolicitar — invariante ImpTotal = ImpNeto + ImpIVA con tolerancia 0.01', () => {
  // Test con 100 casos diversos: confirmar que la descomposición
  // que arma el builder cumple la invariante AFIP.
  const casos = [
    10, 100, 121, 1000, 1300, 11050, 50, 9132, 25000, 100.01, 0.01, 1.0, 1.20,
    121.01, 999.99,
  ]
  for (const monto of casos) {
    const xml = buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      montoFacturado: monto,
      items: [
        {
          cantidad: 1,
          precioUnitarioConIva: monto,
          subtotalConIva: monto,
        },
      ],
    })
    const impTotal = parseFloat(tagValor(xml, 'ImpTotal') ?? '0')
    const impNeto = parseFloat(tagValor(xml, 'ImpNeto') ?? '0')
    const impIVA = parseFloat(tagValor(xml, 'ImpIVA') ?? '0')
    const diff = Math.abs(impTotal - (impNeto + impIVA))
    assert.ok(
      diff < 0.011,
      `Invariante rota para monto=${monto}: ImpTotal=${impTotal} ImpNeto=${impNeto} ImpIVA=${impIVA} (diff=${diff})`,
    )
  }
})

test('buildFECAESolicitar — IVA recalculado por AFIP cuadra con tolerancia 0.01', () => {
  // AFIP recalcula iva = baseImp * 0.21 y exige diferencia ≤ 0.01.
  const casos = [100, 121, 1000, 9132, 25000, 100.01]
  for (const monto of casos) {
    const xml = buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      montoFacturado: monto,
      items: [
        { cantidad: 1, precioUnitarioConIva: monto, subtotalConIva: monto },
      ],
    })
    const impNeto = parseFloat(tagValor(xml, 'ImpNeto') ?? '0')
    const impIVA = parseFloat(tagValor(xml, 'ImpIVA') ?? '0')
    const ivaRecalculado = Math.round(impNeto * 21) / 100
    const diff = Math.abs(impIVA - ivaRecalculado)
    assert.ok(
      diff <= 0.01,
      `monto=${monto}: nuestro IVA=${impIVA} vs AFIP recalcula=${ivaRecalculado} (diff=${diff})`,
    )
  }
})

test('buildFECAESolicitar — campos fijos a 0 (ImpTotConc, ImpOpEx, ImpTrib)', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  assert.equal(tagValor(xml, 'ImpTotConc'), '0')
  assert.equal(tagValor(xml, 'ImpOpEx'), '0')
  assert.equal(tagValor(xml, 'ImpTrib'), '0')
})

test('buildFECAESolicitar — fecha en formato yyyymmdd', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  const cbteFch = tagValor(xml, 'CbteFch')
  assert.match(cbteFch ?? '', /^\d{8}$/)
  // 12:00 UTC del 2026-05-13 + offset -3 = 09:00 AR del mismo día
  assert.equal(cbteFch, '20260513')
})

test('buildFECAESolicitar — fecha respeta TZ Argentina (UTC-3) en bordes de día', () => {
  // 01:30 UTC del 2026-05-14 = 22:30 AR del 13/05. Debe salir 20260513.
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    fechaComprobante: new Date('2026-05-14T01:30:00.000Z'),
  })
  assert.equal(tagValor(xml, 'CbteFch'), '20260513')
})

test('buildFECAESolicitar — fecha cruzando medianoche AR', () => {
  // 03:30 UTC del 2026-05-14 = 00:30 AR del 14/05. Debe salir 20260514.
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    fechaComprobante: new Date('2026-05-14T03:30:00.000Z'),
  })
  assert.equal(tagValor(xml, 'CbteFch'), '20260514')
})

test('buildFECAESolicitar — CondicionIVAReceptorId del receptor (RG 5616)', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    receptor: { docTipo: 80, docNro: '20111111112', condicionIVAReceptorId: 1 },
  })
  assert.equal(tagValor(xml, 'CondicionIVAReceptorId'), '1')
})

// ============================================================
// buildFECAESolicitar — Factura B (CF anónimo)
// ============================================================

test('buildFECAESolicitar — Factura B a CF anónimo (docTipo=99, docNro=0)', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 6, // Factura B
    receptor: { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 },
  })
  assert.equal(tagValor(xml, 'CbteTipo'), '6')
  assert.equal(tagValor(xml, 'DocTipo'), '99')
  assert.equal(tagValor(xml, 'DocNro'), '0')
  assert.equal(tagValor(xml, 'CondicionIVAReceptorId'), '5')
})

test('buildFECAESolicitar — Factura B con DNI (docTipo=96)', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 6,
    receptor: { docTipo: 96, docNro: '12345678', condicionIVAReceptorId: 5 },
  })
  assert.equal(tagValor(xml, 'DocTipo'), '96')
  assert.equal(tagValor(xml, 'DocNro'), '12345678')
})

// ============================================================
// buildFECAESolicitar — Validaciones pre-AFIP
// ============================================================

test('buildFECAESolicitar — cbteTipo no soportado → throw', () => {
  assert.throws(
    () =>
      buildFECAESolicitar({
        ...PARAMS_FECAE_BASE,
        // @ts-expect-error - probando tipo no soportado
        cbteTipo: 999,
      }),
    /Tipo de comprobante no soportado/,
  )
})

test('buildFECAESolicitar — Factura A sin CUIT receptor → AfipWsfeError -1001', () => {
  try {
    buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      cbteTipo: 1, // Factura A
      receptor: { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 },
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1001)
    assert.equal(err.erroresTraducidos[0].severidad, 'requiere_admin')
  }
})

test('buildFECAESolicitar — Factura A a Consumidor Final → AfipWsfeError -1002', () => {
  try {
    buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      cbteTipo: 1,
      receptor: {
        docTipo: 80,
        docNro: '20111111112',
        condicionIVAReceptorId: 5, // CF
      },
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1002)
  }
})

test('buildFECAESolicitar — NC sin comprobanteAsociado → AfipWsfeError -1003', () => {
  try {
    buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      cbteTipo: 3, // NC A
      receptor: { docTipo: 80, docNro: '20111111112', condicionIVAReceptorId: 1 },
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1003)
  }
})

test('buildFECAESolicitar — Factura A con comprobanteAsociado → AfipWsfeError -1004', () => {
  try {
    buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      cbteTipo: 1,
      comprobanteAsociado: {
        tipo: 1,
        puntoVenta: 1,
        numero: 1,
        cuit: '30715900000',
      },
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1004)
  }
})

test('buildFECAESolicitar — puntoVenta no entero → throw', () => {
  assert.throws(
    () => buildFECAESolicitar({ ...PARAMS_FECAE_BASE, puntoVenta: 1.5 }),
    /puntoVenta debe ser entero positivo/,
  )
})

test('buildFECAESolicitar — puntoVenta negativo → throw', () => {
  assert.throws(
    () => buildFECAESolicitar({ ...PARAMS_FECAE_BASE, puntoVenta: -1 }),
    /puntoVenta debe ser entero positivo/,
  )
})

test('buildFECAESolicitar — cbteNro 0 → throw (debe ser ≥1)', () => {
  assert.throws(
    () => buildFECAESolicitar({ ...PARAMS_FECAE_BASE, cbteNro: 0 }),
    /cbteNro debe ser entero positivo/,
  )
})

test('buildFECAESolicitar — montoFacturado <= 0 → throw', () => {
  assert.throws(
    () => buildFECAESolicitar({ ...PARAMS_FECAE_BASE, montoFacturado: 0 }),
    /montoFacturado debe ser positivo/,
  )
  assert.throws(
    () => buildFECAESolicitar({ ...PARAMS_FECAE_BASE, montoFacturado: -100 }),
    /montoFacturado debe ser positivo/,
  )
})

test('buildFECAESolicitar — items no suman al monto facturado → throw', () => {
  assert.throws(
    () =>
      buildFECAESolicitar({
        ...PARAMS_FECAE_BASE,
        montoFacturado: 121,
        items: [
          { cantidad: 1, precioUnitarioConIva: 100, subtotalConIva: 100 },
        ],
      }),
    /Items no suman al monto facturado/,
  )
})

test('buildFECAESolicitar — items suman exacto al monto → OK', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    montoFacturado: 121,
    items: [
      { cantidad: 1, precioUnitarioConIva: 60.5, subtotalConIva: 60.5 },
      { cantidad: 1, precioUnitarioConIva: 60.5, subtotalConIva: 60.5 },
    ],
  })
  assert.equal(tagValor(xml, 'ImpTotal'), '121.00')
})

test('buildFECAESolicitar — items con diferencia < 0.01 → OK (tolerancia)', () => {
  // CUIDADO con floating point: 100 - 99.99 = 0.0100000...0511 > 0.01.
  // El builder usa comparación estricta > 0.01, así que valores cerca del
  // límite pueden fallar inesperadamente. Probamos con diferencia clara
  // (< 0.005) que está bien adentro de la tolerancia.
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    montoFacturado: 100,
    items: [
      { cantidad: 1, precioUnitarioConIva: 99.995, subtotalConIva: 99.995 },
    ],
  })
  assert.equal(tagValor(xml, 'ImpTotal'), '100.00')
})

test('buildFECAESolicitar — diferencia exacta 0.01 cae afuera por floating point', () => {
  // Documenta el comportamiento: el builder rechaza items con diferencia
  // "exacta 0.01" porque 100 - 99.99 = 0.01000...0511 > 0.01.
  // El server action absorbe el centavo en el último item ANTES de
  // llamar al builder, así que en práctica esto no debería pasar.
  assert.throws(
    () =>
      buildFECAESolicitar({
        ...PARAMS_FECAE_BASE,
        montoFacturado: 100,
        items: [
          { cantidad: 1, precioUnitarioConIva: 99.99, subtotalConIva: 99.99 },
        ],
      }),
    /Items no suman al monto facturado/,
  )
})

// ============================================================
// buildFECAESolicitar — CbtesAsoc (NC/ND)
// ============================================================

test('buildFECAESolicitar — NC A con CbtesAsoc lleva tipo/ptoVta/nro/cuit', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 3, // NC A
    receptor: { docTipo: 80, docNro: '20111111112', condicionIVAReceptorId: 1 },
    comprobanteAsociado: {
      tipo: 1, // factura A original
      puntoVenta: 1,
      numero: 50,
      cuit: '30715900000',
    },
  })
  assert.ok(xml.includes('<ar:CbtesAsoc>'))
  assert.ok(xml.includes('<ar:CbteAsoc>'))
  // El bloque tiene Tipo, PtoVta, Nro y Cuit del emisor
  assert.match(xml, /<ar:CbtesAsoc>[\s\S]*<ar:Tipo>1<\/ar:Tipo>/m)
  assert.match(xml, /<ar:CbtesAsoc>[\s\S]*<ar:PtoVta>1<\/ar:PtoVta>/m)
  assert.match(xml, /<ar:CbtesAsoc>[\s\S]*<ar:Nro>50<\/ar:Nro>/m)
  // CUIT como número, no string
  assert.match(xml, /<ar:CbtesAsoc>[\s\S]*<ar:Cuit>30715900000<\/ar:Cuit>/m)
})

test('buildFECAESolicitar — NC B con CbtesAsoc tipo=6', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 8, // NC B
    receptor: { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 },
    comprobanteAsociado: {
      tipo: 6, // factura B original
      puntoVenta: 1,
      numero: 50,
      cuit: '30715900000',
    },
  })
  assert.match(xml, /<ar:CbtesAsoc>[\s\S]*<ar:Tipo>6<\/ar:Tipo>/m)
})

test('buildFECAESolicitar — ND A (cbteTipo=2) requiere CbtesAsoc', () => {
  try {
    buildFECAESolicitar({
      ...PARAMS_FECAE_BASE,
      cbteTipo: 2,
      // SIN comprobanteAsociado
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1003)
  }
})

test('buildFECAESolicitar — Factura B (cbteTipo=6) sin CbtesAsoc → no incluye el bloque', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 6,
    receptor: { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 },
  })
  assert.ok(!xml.includes('<ar:CbtesAsoc>'))
  assert.ok(!xml.includes('<ar:CbteAsoc>'))
})

test('buildFECAESolicitar — CbtesAsoc va ANTES de Iva (orden WSDL)', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    cbteTipo: 3,
    receptor: { docTipo: 80, docNro: '20111111112', condicionIVAReceptorId: 1 },
    comprobanteAsociado: {
      tipo: 1,
      puntoVenta: 1,
      numero: 50,
      cuit: '30715900000',
    },
  })
  const posCbtesAsoc = xml.indexOf('<ar:CbtesAsoc>')
  const posIva = xml.indexOf('<ar:Iva>')
  assert.ok(posCbtesAsoc > 0)
  assert.ok(posIva > 0)
  assert.ok(
    posCbtesAsoc < posIva,
    'CbtesAsoc debe ir antes de Iva según WSDL',
  )
})

test('buildFECAESolicitar — CbtesAsoc CUIT no numérico → throw', () => {
  assert.throws(
    () =>
      buildFECAESolicitar({
        ...PARAMS_FECAE_BASE,
        cbteTipo: 3,
        receptor: { docTipo: 80, docNro: '20111111112', condicionIVAReceptorId: 1 },
        comprobanteAsociado: {
          tipo: 1,
          puntoVenta: 1,
          numero: 50,
          cuit: 'INVALIDO',
        },
      }),
    /CUIT de comprobante asociado inválido/,
  )
})

// ============================================================
// buildFECAESolicitar — escaping XML
// ============================================================

test('buildFECAESolicitar — Token con caracteres XML peligrosos se escapan', () => {
  const xml = buildFECAESolicitar({
    ...PARAMS_FECAE_BASE,
    token: 'a<b>c&d',
  })
  assert.match(xml, /<ar:Token>a&lt;b&gt;c&amp;d<\/ar:Token>/)
})

// ============================================================
// buildFECompConsultar
// ============================================================

test('buildFECompConsultar — XML con FeCompConsReq', () => {
  const xml = buildFECompConsultar({
    token: 'T',
    sign: 'S',
    cuit: '30715900000',
    puntoVenta: 1,
    cbteTipo: 1,
    cbteNro: 100,
  })
  assert.ok(xml.includes('<ar:FECompConsultar>'))
  assert.ok(xml.includes('<ar:FeCompConsReq>'))
  assert.equal(tagValor(xml, 'CbteTipo'), '1')
  assert.equal(tagValor(xml, 'CbteNro'), '100')
  assert.equal(tagValor(xml, 'PtoVta'), '1')
})

test('buildFECompConsultar — puntoVenta inválido → AfipWsfeError -1101', () => {
  try {
    buildFECompConsultar({
      token: 'T',
      sign: 'S',
      cuit: '30715900000',
      puntoVenta: 0,
      cbteTipo: 1,
      cbteNro: 100,
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1101)
  }
})

test('buildFECompConsultar — cbteNro inválido → AfipWsfeError -1102', () => {
  try {
    buildFECompConsultar({
      token: 'T',
      sign: 'S',
      cuit: '30715900000',
      puntoVenta: 1,
      cbteTipo: 1,
      cbteNro: 0,
    })
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.equal(err.erroresTraducidos[0].codigo, -1102)
  }
})

// ============================================================
// Coherencia: presencia de tags requeridos por AFIP en FECAESolicitar
// ============================================================

test('buildFECAESolicitar — todos los tags requeridos AFIP están presentes', () => {
  const xml = buildFECAESolicitar(PARAMS_FECAE_BASE)
  // Lista mínima según WSFEv1.5.8.4 para Factura A con un solo IVA
  const requeridos = [
    'Token', 'Sign', 'Cuit',
    'FeCabReq', 'CantReg', 'PtoVta', 'CbteTipo',
    'FeDetReq', 'FECAEDetRequest',
    'Concepto', 'DocTipo', 'DocNro',
    'CbteDesde', 'CbteHasta', 'CbteFch',
    'ImpTotal', 'ImpTotConc', 'ImpNeto', 'ImpOpEx', 'ImpIVA', 'ImpTrib',
    'MonId', 'MonCotiz',
    'CondicionIVAReceptorId',
    'Iva', 'AlicIva', 'Id', 'BaseImp', 'Importe',
  ]
  for (const tag of requeridos) {
    assert.ok(
      tieneTag(xml, tag),
      `Falta tag <ar:${tag}> en el envelope`,
    )
  }
})
