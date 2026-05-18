import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  parseFEDummyResponse,
  parseFECompUltimoAutorizadoResponse,
  parseFECAESolicitarResponse,
  parseFECompConsultarResponse,
} from './parsers'
import { AfipWsfeError } from './types'

// ============================================================
// Fixtures de respuestas AFIP
// ============================================================

const SOAP_FAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>WSAA: token expirado</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`

const FE_DUMMY_OK = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FEDummyResult>
        <AppServer>OK</AppServer>
        <DbServer>OK</DbServer>
        <AuthServer>OK</AuthServer>
      </FEDummyResult>
    </FEDummyResponse>
  </soap:Body>
</soap:Envelope>`

const FE_DUMMY_ERROR = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FEDummyResult>
        <AppServer>OK</AppServer>
        <DbServer>ERROR</DbServer>
        <AuthServer>OK</AuthServer>
      </FEDummyResult>
    </FEDummyResponse>
  </soap:Body>
</soap:Envelope>`

const FE_ULTIMO_OK = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompUltimoAutorizadoResult>
        <PtoVta>1</PtoVta>
        <CbteTipo>1</CbteTipo>
        <CbteNro>100</CbteNro>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`

const FE_ULTIMO_CERO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompUltimoAutorizadoResult>
        <PtoVta>1</PtoVta>
        <CbteTipo>1</CbteTipo>
        <CbteNro>0</CbteNro>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`

const FE_ULTIMO_CON_ERROR = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompUltimoAutorizadoResult>
        <Errors>
          <Err>
            <Code>600</Code>
            <Msg>Token autenticación inválido</Msg>
          </Err>
        </Errors>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CAE_APROBADO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <FeCabResp>
          <Cuit>30715900000</Cuit>
          <PtoVta>1</PtoVta>
          <CbteTipo>1</CbteTipo>
          <FchProceso>20260513</FchProceso>
          <CantReg>1</CantReg>
          <Resultado>A</Resultado>
          <Reproceso>N</Reproceso>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Concepto>1</Concepto>
            <DocTipo>80</DocTipo>
            <DocNro>20111111112</DocNro>
            <CbteDesde>101</CbteDesde>
            <CbteHasta>101</CbteHasta>
            <CbteFch>20260513</CbteFch>
            <Resultado>A</Resultado>
            <CAE>75123456789012</CAE>
            <CAEFchVto>20260523</CAEFchVto>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CAE_CON_OBSERVACION_OK = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <FeCabResp>
          <Resultado>A</Resultado>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <CbteDesde>101</CbteDesde>
            <CbteHasta>101</CbteHasta>
            <Observaciones>
              <Obs>
                <Code>20009</Code>
                <Msg>CUIT del cliente con deuda con AFIP</Msg>
              </Obs>
            </Observaciones>
            <Resultado>A</Resultado>
            <CAE>75123456789012</CAE>
            <CAEFchVto>20260523</CAEFchVto>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CAE_RECHAZADO = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <FeCabResp>
          <Resultado>R</Resultado>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Resultado>R</Resultado>
            <CAE/>
            <CAEFchVto/>
            <CbteDesde>0</CbteDesde>
            <Observaciones>
              <Obs>
                <Code>10015</Code>
                <Msg>Documento del receptor incorrecto</Msg>
              </Obs>
            </Observaciones>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CAE_CON_ERRORS_NIVEL_RESULT = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECAESolicitarResult>
        <Errors>
          <Err>
            <Code>600</Code>
            <Msg>Token autenticación inválido</Msg>
          </Err>
        </Errors>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CONSULTAR_NO_EXISTE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompConsultarResult>
        <Errors>
          <Err>
            <Code>602</Code>
            <Msg>No existen datos en nuestros archivos</Msg>
          </Err>
        </Errors>
      </FECompConsultarResult>
    </FECompConsultarResponse>
  </soap:Body>
</soap:Envelope>`

const FE_CONSULTAR_EXISTE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompConsultarResult>
        <ResultGet>
          <Concepto>1</Concepto>
          <DocTipo>80</DocTipo>
          <DocNro>20111111112</DocNro>
          <CbteDesde>101</CbteDesde>
          <CbteHasta>101</CbteHasta>
          <CbteFch>20260513</CbteFch>
          <ImpTotal>121.00</ImpTotal>
          <ImpNeto>100.00</ImpNeto>
          <ImpIVA>21.00</ImpIVA>
          <FchVto>20260523</FchVto>
          <Resultado>A</Resultado>
          <CodAutorizacion>75123456789012</CodAutorizacion>
        </ResultGet>
      </FECompConsultarResult>
    </FECompConsultarResponse>
  </soap:Body>
</soap:Envelope>`

// ============================================================
// parseFEDummyResponse
// ============================================================

test('parseFEDummyResponse — todos los servers OK', () => {
  const r = parseFEDummyResponse(FE_DUMMY_OK)
  assert.equal(r.appServer, 'OK')
  assert.equal(r.dbServer, 'OK')
  assert.equal(r.authServer, 'OK')
})

test('parseFEDummyResponse — DB caída marca ERROR', () => {
  const r = parseFEDummyResponse(FE_DUMMY_ERROR)
  assert.equal(r.dbServer, 'ERROR')
  assert.equal(r.appServer, 'OK')
})

test('parseFEDummyResponse — SOAP Fault → throw AfipWsfeError', () => {
  assert.throws(
    () => parseFEDummyResponse(SOAP_FAULT_XML),
    (err: Error) =>
      err instanceof AfipWsfeError && /SOAP Fault/.test(err.message),
  )
})

test('parseFEDummyResponse — XML malformado → throw AfipWsfeError', () => {
  assert.throws(
    () => parseFEDummyResponse('<broken<<>>'),
    (err: Error) => err instanceof AfipWsfeError,
  )
})

// ============================================================
// parseFECompUltimoAutorizadoResponse
// ============================================================

test('parseFECompUltimoAutorizadoResponse — devuelve número', () => {
  const r = parseFECompUltimoAutorizadoResponse(FE_ULTIMO_OK)
  assert.equal(r.numeroComprobante, 100)
  assert.equal(r.puntoVenta, 1)
  assert.equal(r.tipoComprobante, 1)
})

test('parseFECompUltimoAutorizadoResponse — primera emisión devuelve 0', () => {
  // Antes de emitir nada, AFIP devuelve CbteNro=0. El próximo a emitir es el 1.
  const r = parseFECompUltimoAutorizadoResponse(FE_ULTIMO_CERO)
  assert.equal(r.numeroComprobante, 0)
})

test('parseFECompUltimoAutorizadoResponse — Errors collection → throw con código', () => {
  try {
    parseFECompUltimoAutorizadoResponse(FE_ULTIMO_CON_ERROR)
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.deepEqual(err.contexto.codigosError, [600])
    assert.equal(err.contexto.mensajesError?.[0], 'Token autenticación inválido')
  }
})

// ============================================================
// parseFECAESolicitarResponse
// ============================================================

test('parseFECAESolicitarResponse — CAE aprobado extrae todos los campos', () => {
  const r = parseFECAESolicitarResponse(FE_CAE_APROBADO)
  assert.equal(r.cae, '75123456789012')
  assert.equal(r.caeFchVto, '20260523')
  assert.equal(r.cbteNro, 101)
  assert.equal(r.resultado, 'A')
  assert.equal(r.observaciones.length, 0)
})

test('parseFECAESolicitarResponse — aprobado con observaciones (warning) las devuelve', () => {
  const r = parseFECAESolicitarResponse(FE_CAE_CON_OBSERVACION_OK)
  assert.equal(r.cae, '75123456789012')
  assert.equal(r.observaciones.length, 1)
  assert.equal(r.observaciones[0].codigo, 20009)
  assert.match(r.observaciones[0].mensaje, /deuda con AFIP/)
})

test('parseFECAESolicitarResponse — rechazado → throw con códigos clasificados', () => {
  try {
    parseFECAESolicitarResponse(FE_CAE_RECHAZADO)
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.deepEqual(err.contexto.codigosError, [10015])
    // 10015 (DocNro inválido) está clasificado como requiere_admin
    assert.equal(err.erroresTraducidos[0].severidad, 'requiere_admin')
  }
})

test('parseFECAESolicitarResponse — Errors a nivel Result → throw', () => {
  try {
    parseFECAESolicitarResponse(FE_CAE_CON_ERRORS_NIVEL_RESULT)
    assert.fail('Esperaba throw')
  } catch (err) {
    assert.ok(err instanceof AfipWsfeError)
    assert.deepEqual(err.contexto.codigosError, [600])
  }
})

test('parseFECAESolicitarResponse — SOAP Fault → throw', () => {
  assert.throws(
    () => parseFECAESolicitarResponse(SOAP_FAULT_XML),
    (err: Error) =>
      err instanceof AfipWsfeError && /SOAP Fault/.test(err.message),
  )
})

test('parseFECAESolicitarResponse — CAE vacío con Resultado=A → throw "incompleta"', () => {
  // Si AFIP responde Resultado=A pero CAE vacío (no debería pasar, pero
  // bug de AFIP no debe pasar silencioso → debe throw).
  const xml = FE_CAE_APROBADO.replace(
    '<CAE>75123456789012</CAE>',
    '<CAE></CAE>',
  )
  assert.throws(
    () => parseFECAESolicitarResponse(xml),
    (err: Error) =>
      err instanceof AfipWsfeError && /incompleta/.test(err.message),
  )
})

// ============================================================
// parseFECompConsultarResponse — idempotencia
// ============================================================

test('parseFECompConsultarResponse — "no existe" → { existe: false }', () => {
  const r = parseFECompConsultarResponse(FE_CONSULTAR_NO_EXISTE)
  assert.equal(r.existe, false)
})

test('parseFECompConsultarResponse — existente → devuelve CAE + datos', () => {
  const r = parseFECompConsultarResponse(FE_CONSULTAR_EXISTE)
  assert.equal(r.existe, true)
  if (r.existe) {
    assert.equal(r.cae, '75123456789012')
    assert.equal(r.caeFchVto, '20260523')
    assert.equal(r.cbteNro, 101)
    assert.equal(r.resultado, 'A')
    assert.equal(r.impTotal, 121.0)
  }
})

test('parseFECompConsultarResponse — SOAP Fault → throw', () => {
  assert.throws(
    () => parseFECompConsultarResponse(SOAP_FAULT_XML),
    (err: Error) => err instanceof AfipWsfeError,
  )
})

test('parseFECompConsultarResponse — Resultado="R" en existente se devuelve (caller lo handle)', () => {
  const xml = FE_CONSULTAR_EXISTE.replace(
    '<Resultado>A</Resultado>',
    '<Resultado>R</Resultado>',
  )
  const r = parseFECompConsultarResponse(xml)
  assert.equal(r.existe, true)
  if (r.existe) {
    assert.equal(r.resultado, 'R')
  }
})

test('parseFECompConsultarResponse — Resultado inválido (no A/R/P) → throw', () => {
  const xml = FE_CONSULTAR_EXISTE.replace(
    '<Resultado>A</Resultado>',
    '<Resultado>X</Resultado>',
  )
  assert.throws(
    () => parseFECompConsultarResponse(xml),
    (err: Error) => err instanceof AfipWsfeError && /Resultado inesperado/.test(err.message),
  )
})

test('parseFECompConsultarResponse — ImpTotal con formato extraño → throw', () => {
  const xml = FE_CONSULTAR_EXISTE.replace(
    '<ImpTotal>121.00</ImpTotal>',
    '<ImpTotal>NO_NUMERICO</ImpTotal>',
  )
  assert.throws(
    () => parseFECompConsultarResponse(xml),
    (err: Error) => err instanceof AfipWsfeError && /ImpTotal/.test(err.message),
  )
})
