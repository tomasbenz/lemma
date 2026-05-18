import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import {
  validateMPWebhookSignature,
  MP_WEBHOOK_TS_TOLERANCE_SECONDS,
} from './webhook-signature'

// Helper para construir un header `x-signature` con firma válida computada
// con el algoritmo oficial de MP. Recibe el secret + las 3 piezas del
// manifest y devuelve el header armado.
function firmarManifest({
  dataId,
  xRequestId,
  ts,
  secret,
}: {
  dataId: string
  xRequestId: string
  ts: string
  secret: string
}): string {
  const id = /[a-zA-Z]/.test(dataId) ? dataId.toLowerCase() : dataId
  const manifest = `id:${id};request-id:${xRequestId};ts:${ts};`
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex')
  return `ts=${ts},v1=${v1}`
}

const DEFAULT_SECRET = 'test_secret_with_some_entropy_aaaaaaaaaaaaaa'
const DEFAULT_REQUEST_ID = '12345-abcde-67890-fghij'
const DEFAULT_DATA_ID = '987654321'
const NOW = 1_704_908_010 // 2024-01-10 UTC, fijo para reproducibilidad

// ============================================================================
// Happy path
// ============================================================================

test('validateMPWebhookSignature — firma correcta devuelve {valid: true}', () => {
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

test('validateMPWebhookSignature — data.id con letras se lowercased en manifest', () => {
  const ts = String(NOW)
  // MP doc: si data.id tiene letras → lowercase. El helper firmarManifest hace
  // ese mismo lowercase, así que firmamos con la versión lowercased y el
  // valdiador debe matchear el upper-case original via lowercasing interno.
  const dataIdUpper = 'AbC123XyZ'
  const sig = firmarManifest({
    dataId: dataIdUpper,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: dataIdUpper, // tal como vino del header (con mayúsculas)
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

test('validateMPWebhookSignature — data.id solo dígitos NO se lowercased (es no-op igual)', () => {
  // Los dígitos no se afectan por toLowerCase, pero la rama del código
  // diferencia entre "tiene letras" y "solo dígitos". Cubrimos ambas.
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: '999888777',
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: '999888777',
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

// ============================================================================
// Headers ausentes / inputs incompletos
// ============================================================================

test('validateMPWebhookSignature — falta secret', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=1,v1=' + 'a'.repeat(64),
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: '',
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /secret/)
})

test('validateMPWebhookSignature — falta x-signature', () => {
  const r = validateMPWebhookSignature({
    xSignature: null,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /x-signature/)
})

test('validateMPWebhookSignature — falta x-request-id', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=1,v1=' + 'a'.repeat(64),
    xRequestId: null,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /x-request-id/)
})

test('validateMPWebhookSignature — falta data.id', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=1,v1=' + 'a'.repeat(64),
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: null,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /data\.id/)
})

// ============================================================================
// Header malformado / parseo
// ============================================================================

test('validateMPWebhookSignature — header sin ts rechaza', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'v1=' + 'a'.repeat(64),
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /malformado/)
})

test('validateMPWebhookSignature — header sin v1 rechaza', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=1704908010',
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /malformado/)
})

test('validateMPWebhookSignature — ts no numérico rechaza', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=hola,v1=' + 'a'.repeat(64),
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /malformado/)
})

test('validateMPWebhookSignature — v1 con largo distinto a 64 rechaza', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=' + NOW + ',v1=abc123',
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /malformado/)
})

test('validateMPWebhookSignature — v1 con caracteres no-hex rechaza', () => {
  const r = validateMPWebhookSignature({
    xSignature: 'ts=' + NOW + ',v1=' + 'z'.repeat(64),
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /malformado/)
})

test('validateMPWebhookSignature — header con espacios extra entre items igual parsea', () => {
  // El parser hace trim() de cada parte, así que "ts=X , v1=Y" debe funcionar.
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  // Sumamos espacios
  const sigConEspacios = sig
    .split(',')
    .map((p) => '  ' + p + ' ')
    .join(',')
  const r = validateMPWebhookSignature({
    xSignature: sigConEspacios,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

// ============================================================================
// Ventana de timestamp (anti-replay)
// ============================================================================

test('validateMPWebhookSignature — ts dentro de la ventana acepta', () => {
  // ts = now - (tolerancia - 1) → todavía dentro
  const ts = String(NOW - (MP_WEBHOOK_TS_TOLERANCE_SECONDS - 1))
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

test('validateMPWebhookSignature — ts fuera de la ventana (viejo) rechaza', () => {
  const ts = String(NOW - (MP_WEBHOOK_TS_TOLERANCE_SECONDS + 1))
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /tolerancia/)
})

test('validateMPWebhookSignature — ts del futuro fuera de ventana rechaza', () => {
  // Caso de clock skew malo o ataque
  const ts = String(NOW + (MP_WEBHOOK_TS_TOLERANCE_SECONDS + 1))
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /tolerancia/)
})

test('validateMPWebhookSignature — ts justo en el borde de la ventana acepta', () => {
  // ts = now - tolerancia (exactamente) → debe aceptarse por <=
  const ts = String(NOW - MP_WEBHOOK_TS_TOLERANCE_SECONDS)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, true)
})

// ============================================================================
// Tampering (firma no matchea)
// ============================================================================

test('validateMPWebhookSignature — secret distinto rechaza', () => {
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: 'otro_secret_completamente_distinto',
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /no matchea/)
})

test('validateMPWebhookSignature — data.id tampered (sig firmada con otro) rechaza', () => {
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: 'data-original',
    xRequestId: DEFAULT_REQUEST_ID,
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: 'data-tampered', // atacante cambió el body
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /no matchea/)
})

test('validateMPWebhookSignature — request-id tampered rechaza', () => {
  const ts = String(NOW)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: 'request-original',
    ts,
    secret: DEFAULT_SECRET,
  })
  const r = validateMPWebhookSignature({
    xSignature: sig,
    xRequestId: 'request-tampered',
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /no matchea/)
})

test('validateMPWebhookSignature — ts en header distinto al firmado rechaza', () => {
  // Si el atacante cambia el ts del header pero deja la v1 vieja, el manifest
  // recomputado va a diferir → HMAC distinto → rechazo.
  const tsViejo = String(NOW - 60)
  const sig = firmarManifest({
    dataId: DEFAULT_DATA_ID,
    xRequestId: DEFAULT_REQUEST_ID,
    ts: tsViejo,
    secret: DEFAULT_SECRET,
  })
  // Reemplazamos ts en el header pero dejamos v1 (firma con tsViejo)
  const tsNuevo = String(NOW)
  const sigTampered = sig.replace(`ts=${tsViejo}`, `ts=${tsNuevo}`)
  const r = validateMPWebhookSignature({
    xSignature: sigTampered,
    xRequestId: DEFAULT_REQUEST_ID,
    dataId: DEFAULT_DATA_ID,
    secret: DEFAULT_SECRET,
    now: NOW,
  })
  assert.equal(r.valid, false)
  if (!r.valid) assert.match(r.error, /no matchea/)
})

// ============================================================================
// Constante MP_WEBHOOK_TS_TOLERANCE_SECONDS
// ============================================================================

test('MP_WEBHOOK_TS_TOLERANCE_SECONDS — valor por defecto razonable (300s = 5min)', () => {
  // No queremos que alguien la baje a 1s (rompe clock skew real) ni la suba
  // a 24h (acepta replays viejos).
  assert.ok(MP_WEBHOOK_TS_TOLERANCE_SECONDS >= 60, 'mínimo 1 minuto')
  assert.ok(
    MP_WEBHOOK_TS_TOLERANCE_SECONDS <= 600,
    'máximo 10 minutos (anti-replay)'
  )
})
