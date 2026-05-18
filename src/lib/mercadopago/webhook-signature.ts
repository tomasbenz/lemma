import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Tolerancia para el timestamp del header `x-signature`. MP no recomienda
 * un valor específico; 5 minutos cubre clock skew razonable y rechaza
 * replays viejos (vector #2 del threat model).
 */
export const MP_WEBHOOK_TS_TOLERANCE_SECONDS = 300

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string }

export type ValidateInput = {
  xSignature: string | null
  xRequestId: string | null
  dataId: string | null
  secret: string
  /** Inyectable para tests; default = ahora en segundos Unix. */
  now?: number
}

type ParsedSignature = { ts: string; v1: string }

function parseSignature(header: string): ParsedSignature | null {
  // Formato MP: "ts=1704908010,v1=618c8534..." (separador coma, key=value).
  const parts = header.split(',').map((p) => p.trim())
  let ts: string | undefined
  let v1: string | undefined
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq)
    const v = part.slice(eq + 1)
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  if (!ts || !v1) return null
  if (!/^\d+$/.test(ts)) return null
  if (!/^[a-f0-9]{64}$/.test(v1)) return null
  return { ts, v1 }
}

function verifyTimestamp(ts: string, now: number): boolean {
  const tsNum = Number.parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return false
  return Math.abs(now - tsNum) <= MP_WEBHOOK_TS_TOLERANCE_SECONDS
}

function buildManifest(
  dataId: string,
  xRequestId: string,
  ts: string
): string {
  // Regla MP: si data.id contiene letras → lowercased.
  // Solo dígitos → tal cual.
  const id = /[a-zA-Z]/.test(dataId) ? dataId.toLowerCase() : dataId
  return `id:${id};request-id:${xRequestId};ts:${ts};`
}

function computeAndCompare(
  manifest: string,
  receivedV1: string,
  secret: string
): boolean {
  const computedHex = createHmac('sha256', secret)
    .update(manifest)
    .digest('hex')
  const received = Buffer.from(receivedV1, 'hex')
  const computed = Buffer.from(computedHex, 'hex')
  // Length check antes de timingSafeEqual (que tira si difieren).
  // Ambos deberían ser 32 bytes (SHA256 hex de 64 chars).
  if (received.length !== computed.length) return false
  return timingSafeEqual(received, computed)
}

/**
 * Valida la firma `x-signature` de un webhook de Mercado Pago.
 *
 * Implementa el algoritmo de la doc oficial:
 * https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 *
 * Defensas extra sobre lo que recomienda MP:
 *   - Comparación constant-time (`crypto.timingSafeEqual`)
 *   - Ventana de validez de `ts` (`MP_WEBHOOK_TS_TOLERANCE_SECONDS`)
 *   - Rechazo de hex/header malformado antes de comparar
 */
export function validateMPWebhookSignature(
  input: ValidateInput
): ValidationResult {
  const { xSignature, xRequestId, dataId, secret } = input
  const now = input.now ?? Math.floor(Date.now() / 1000)

  if (!secret) return { valid: false, error: 'secret no configurado' }
  if (!xSignature) return { valid: false, error: 'header x-signature ausente' }
  if (!xRequestId)
    return { valid: false, error: 'header x-request-id ausente' }
  if (!dataId) return { valid: false, error: 'data.id ausente' }

  const parsed = parseSignature(xSignature)
  if (!parsed) return { valid: false, error: 'header x-signature malformado' }

  if (!verifyTimestamp(parsed.ts, now)) {
    return { valid: false, error: 'ts fuera de ventana de tolerancia' }
  }

  const manifest = buildManifest(dataId, xRequestId, parsed.ts)
  if (!computeAndCompare(manifest, parsed.v1, secret)) {
    return { valid: false, error: 'firma no matchea' }
  }

  return { valid: true }
}
