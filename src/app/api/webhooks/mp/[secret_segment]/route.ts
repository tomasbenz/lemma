import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MP_WEBHOOK_TS_TOLERANCE_SECONDS,
  validateMPWebhookSignature,
} from '@/lib/mercadopago/webhook-signature'
import { MPWebhookBodySchema } from '@/lib/mercadopago/webhook-schema'

// node:crypto + admin client → forzar runtime node
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 32_000
const RAW_TRUNCATE_BYTES = 1_000

type AdminClient = ReturnType<typeof createAdminClient>

function emptyResponse(status: number) {
  return new NextResponse(null, { status })
}

function ok() {
  return NextResponse.json({ ok: true }, { status: 200 })
}

function unauthorized() {
  return NextResponse.json({ ok: false }, { status: 401 })
}

type SegmentCheck =
  | { ok: true }
  | { ok: false; reason: 'mismatch' | 'missing_in_prod' }

function checkSegment(urlSegment: string): SegmentCheck {
  const expected = process.env.MP_WEBHOOK_PATH_SEGMENT
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      // Fail-closed en prod: la falta de segment es misconfig, no 404.
      // Devolver 503 para que MP reintente cuando se settee la env.
      console.error(
        '[mp-webhook] MP_WEBHOOK_PATH_SEGMENT no configurado en production — fail-closed'
      )
      return { ok: false, reason: 'missing_in_prod' }
    }
    console.warn(
      '[mp-webhook] MP_WEBHOOK_PATH_SEGMENT no configurado; ' +
        'aceptando cualquier segment (solo aceptable en dev)'
    )
    return { ok: true }
  }
  return urlSegment === expected
    ? { ok: true }
    : { ok: false, reason: 'mismatch' }
}

async function readCappedBody(request: NextRequest): Promise<string | null> {
  const declared = request.headers.get('content-length')
  if (declared && Number.parseInt(declared, 10) > MAX_BODY_BYTES) {
    return null
  }
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return null
  return raw
}

async function lookupTenant(supabase: AdminClient, paymentId: string) {
  return supabase
    .from('pagos')
    .select('id, empresa_id, venta_id, estado')
    .eq('mp_payment_id', paymentId)
    .maybeSingle()
}

async function markProcesado(
  supabase: AdminClient,
  eventId: string,
  patch: { empresa_id?: string | null; error?: string | null }
) {
  await supabase
    .from('mp_webhook_events')
    .update({
      procesado: true,
      procesado_at: new Date().toISOString(),
      ...patch,
    })
    .eq('event_id', eventId)
}

/**
 * Persiste un evento descartado para mantener trazabilidad de payloads
 * que rechazamos antes del flujo normal (JSON malformado o body que no
 * matchea schema). Idempotente vía UNIQUE(event_id): si MP reenvía con
 * el mismo `x-request-id` el 23505 se swalowea.
 *
 * `payload` se guarda truncado para evitar guardar payloads gigantes
 * cuando un atacante o un bug de MP nos manda basura.
 */
async function persistDiscarded(
  supabase: AdminClient,
  args: {
    eventId: string
    topic: 'malformed' | 'schema_mismatch'
    resourceId: string
    raw: string
    error: string
  }
) {
  const insert = await supabase.from('mp_webhook_events').insert({
    event_id: args.eventId,
    topic: args.topic,
    resource_id: args.resourceId,
    payload: { raw_truncated: args.raw.slice(0, RAW_TRUNCATE_BYTES) } as never,
    error: args.error,
    procesado: true,
    procesado_at: new Date().toISOString(),
  })
  if (insert.error && insert.error.code !== '23505') {
    console.error(
      '[mp-webhook] insert evento descartado falló:',
      insert.error
    )
  }
}

/**
 * Receptor de webhooks de Mercado Pago.
 *
 * Defensas (ver threat model en branch security/audit-webhooks):
 *   1. Path con segment random (`MP_WEBHOOK_PATH_SEGMENT`) para reducir
 *      escaneo automático. Fail-closed (503) en prod si falta la env.
 *   2. Fail-closed si falta `MP_WEBHOOK_SECRET`.
 *   3. Validación HMAC-SHA256 con `crypto.timingSafeEqual` y ventana de
 *      ts (±300s) — vectors #1, #2, #4.
 *   4. Body cap explícito de 32 KB — vector #5.
 *   5. Idempotencia atómica vía `INSERT ... ON CONFLICT (event_id)` —
 *      vector #3.
 *   6. Lookup de tenant por `mp_payment_id` (nunca aceptamos `empresa_id`
 *      desde URL/body) — vector #9.
 *   7. Match estricto entre `data.id` del query (firmado) y del body para
 *      type='payment'; mismatch = discard.
 *   8. Trazabilidad: payloads descartados se persisten con topic
 *      'malformed' / 'schema_mismatch' (raw truncado).
 *   9. Respuestas mínimas, errores solo server-side — vector #7.
 *
 * NO hace todavía:
 *   - Llamada a MP API para confirmar status real del pago.
 *   - Update de `pagos.estado` / `pagos.confirmed_at`.
 *   Eso entra cuando se construya el flujo outbound (creación de
 *   preferences). Mientras tanto, los eventos quedan en
 *   `mp_webhook_events` listos para procesar por un job aparte.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret_segment: string }> }
) {
  const { secret_segment: urlSegment } = await params

  // -------- AJUSTE 1: secret URL segment --------
  const segment = checkSegment(urlSegment)
  if (!segment.ok) {
    // mismatch real → 404 (atacante escaneando, no le damos pistas).
    // missing_in_prod → 503 (misconfig: que MP reintente).
    return emptyResponse(segment.reason === 'missing_in_prod' ? 503 : 404)
  }

  // -------- secret HMAC --------
  const secret = process.env.MP_WEBHOOK_SECRET
  if (!secret) {
    console.error(
      '[mp-webhook] MP_WEBHOOK_SECRET no configurado — fail-closed'
    )
    return emptyResponse(503)
  }

  // -------- query + headers --------
  const url = new URL(request.url)
  const dataId = url.searchParams.get('data.id')
  const xSignature = request.headers.get('x-signature')
  const xRequestId = request.headers.get('x-request-id')

  // -------- validación de firma --------
  const validation = validateMPWebhookSignature({
    xSignature,
    xRequestId,
    dataId,
    secret,
  })
  if (!validation.valid) {
    console.warn('[mp-webhook] firma rechazada:', validation.error, {
      dataId,
      xRequestId,
      ts_tolerance_s: MP_WEBHOOK_TS_TOLERANCE_SECONDS,
    })
    return unauthorized()
  }

  // Si la firma es válida, dataId y xRequestId están presentes (la función
  // de validación los exige). Re-narrow defensivo para TS y para no
  // depender de un invariante implícito.
  if (!xRequestId || !dataId) return unauthorized()

  // -------- body con cap --------
  const raw = await readCappedBody(request)
  if (raw === null) return emptyResponse(413)

  const supabase = createAdminClient()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Body no es JSON: descartamos sin reintentar (200 → MP no insiste).
    // Pero persistimos un registro para trazabilidad.
    console.warn('[mp-webhook] body JSON malformado; descartado')
    await persistDiscarded(supabase, {
      eventId: xRequestId,
      topic: 'malformed',
      resourceId: dataId,
      raw,
      error: 'body JSON malformado',
    })
    return ok()
  }

  const bodyResult = MPWebhookBodySchema.safeParse(parsed)
  if (!bodyResult.success) {
    // Solo path + code: los `issues` completos pueden incluir el valor
    // recibido (`received`) que no queremos en logs.
    const safeIssues = bodyResult.error.issues.map((i) => ({
      path: i.path,
      code: i.code,
    }))
    console.warn(
      '[mp-webhook] body no matchea schema; descartado',
      safeIssues
    )
    await persistDiscarded(supabase, {
      eventId: xRequestId,
      topic: 'schema_mismatch',
      resourceId: dataId,
      raw,
      error: 'body no matchea schema',
    })
    return ok()
  }
  const body = bodyResult.data
  const eventId = String(body.id)
  const resourceId = String(body.data.id)

  // -------- match data.id query vs body --------
  // La firma valida solo el `data.id` del query string. Un body con
  // `data.id` distinto al firmado es signal de atacante con secret
  // leakeado (re-firma con dataId atacante pero cambia body) o de bug
  // de MP. Discard sin persistir — no le damos al atacante un canal
  // para escribir en mp_webhook_events.
  if (body.type === 'payment' && resourceId !== dataId) {
    console.warn('[mp-webhook] resource id del body no matchea query', {
      query_data_id: dataId,
      body_data_id: resourceId,
      x_request_id: xRequestId,
    })
    return ok()
  }

  // -------- idempotencia atómica --------
  const insert = await supabase.from('mp_webhook_events').insert({
    event_id: eventId,
    topic: body.type,
    resource_id: resourceId,
    payload: body as never,
  })

  if (insert.error) {
    // 23505 = unique_violation Postgres → ya existía, idempotencia ok.
    if (insert.error.code === '23505') return ok()
    console.error(
      '[mp-webhook] insert mp_webhook_events falló:',
      insert.error
    )
    // NO incluir error.message en el body del response.
    return emptyResponse(500)
  }

  // -------- procesamiento síncrono --------
  // TODO: mover a queue (Inngest / QStash / pg_cron) cuando se cumpla
  // CUALQUIERA de:
  //   - el handler haga >5 queries (hoy hace ~3)
  //   - lleguen >50 webhooks/día
  //   - el p95 del handler supere 1 segundo
  // Mientras esto no pase, sync dentro del request es lo más simple
  // y cabe sobrado en los 22s de timeout que da MP.
  try {
    if (body.type === 'payment') {
      await procesarPayment(supabase, eventId, resourceId)
    } else {
      await markProcesado(supabase, eventId, {
        error: `tipo no manejado: ${body.type}`,
      })
    }
  } catch (err) {
    // Detalles solo server-side. NO incluir error.message en el body
    // del response.
    console.error('[mp-webhook] procesamiento falló:', err)
    await supabase
      .from('mp_webhook_events')
      .update({
        error:
          err instanceof Error ? err.message : 'error desconocido',
      })
      .eq('event_id', eventId)
    return emptyResponse(500)
  }

  return ok()
}

async function procesarPayment(
  supabase: AdminClient,
  eventId: string,
  paymentId: string
) {
  const pagoQ = await lookupTenant(supabase, paymentId)
  if (pagoQ.error) throw pagoQ.error

  if (!pagoQ.data) {
    await markProcesado(supabase, eventId, {
      error: 'payment no encontrado en tabla pagos',
    })
    return
  }

  // Tenant resuelto. La actualización real de pagos.estado
  // queda para cuando exista el flujo outbound (creación de
  // preferences + fetch a https://api.mercadopago.com/v1/payments/<id>).
  await markProcesado(supabase, eventId, {
    empresa_id: pagoQ.data.empresa_id,
  })
}
