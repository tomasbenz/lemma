import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Helpers de recuperación cuando una emisión a AFIP falla.
 *
 * NO se integra con el flujo de cobro de caja todavía — eso es Fase 4.b.
 * Acá es plumbing: definir API y mantener la columna `estado_facturacion_afip`
 * en `ventas` consistente con lo que pasa en cada intento de emisión.
 *
 * Workflow conceptual (lo va a invocar Fase 4.b):
 *
 *   import { esErrorReintentableAfip } from '@/lib/afip/retry'
 *
 *   try {
 *     const cae = await emitirFactura(venta)
 *     await marcarVentaEmitida({ ventaId, empresaId, requestLogId })
 *   } catch (err) {
 *     // Usar esErrorReintentableAfip — cubre AfipWsfeError con severidad
 *     // reintentable Y network errors (UND_ERR_*, ECONNRESET, etc).
 *     // NO duplicar la lógica acá: si retry.ts cambia criterios, esto
 *     // queda coherente.
 *     await marcarVentaFallaFacturacion({
 *       ventaId,
 *       empresaId,
 *       motivo: {
 *         requestLogId,
 *         errorMensaje: err instanceof Error ? err.message : String(err),
 *         esReintentable: esErrorReintentableAfip(err),
 *       },
 *     })
 *     // NO bloqueamos el cierre de caja: la venta queda registrada y
 *     // el admin la trata después.
 *   }
 */

export type MotivoFalla = {
  /** ID de afip_request_log del último intento, o null si no se llegó a loguear. */
  requestLogId: number | null
  /** Mensaje legible (ya traducido si es AfipWsfeError, ver formatearMensajeErroresTraducidos). */
  errorMensaje: string
  /**
   * true → la venta queda en 'pendiente_facturacion' (el admin puede reintentar).
   * false → 'error_permanente' (el admin debe decidir explícitamente).
   */
  esReintentable: boolean
}

export type ParametrosMarcarFalla = {
  ventaId: string
  /**
   * empresa_id de la venta. Defense in depth multi-tenant: la mutación
   * filtra por (id, empresa_id) y throw si no hay match — silent skip
   * ocultaría tampering o routing incorrecto del caller.
   */
  empresaId: string
  motivo: MotivoFalla
}

export type ParametrosMarcarEmitida = {
  ventaId: string
  /** Idem ParametrosMarcarFalla.empresaId — filtro multi-tenant obligatorio. */
  empresaId: string
  /** ID del afip_request_log de la emisión exitosa (si está disponible). */
  requestLogId: number | null
}


/**
 * Marca una venta con falla de facturación AFIP.
 *
 * Idempotente: si la venta ya estaba en pendiente_facturacion/error_permanente,
 * actualiza con la nueva info pero no falla. La idempotencia es importante
 * porque Fase 4.b puede reintentar emitir desde un job y queremos que cada
 * intento actualice timestamp + log_id sin error.
 *
 * TODO post-Fase-4.b: cuando exista infra de notificaciones (email admin
 * o canal Slack), notificar acá especialmente cuando esReintentable=false
 * (error permanente requiere intervención humana).
 */
export async function marcarVentaFallaFacturacion(
  params: ParametrosMarcarFalla,
): Promise<void> {
  const { ventaId, empresaId, motivo } = params
  const supabase = createAdminClient()

  // El tipo del campo viene del enum `estado_facturacion_afip` generado en
  // database.ts; TS infiere el literal correcto del ternario.
  const nuevoEstado = motivo.esReintentable
    ? 'pendiente_facturacion'
    : 'error_permanente'

  // .select('id') después del UPDATE devuelve las filas afectadas. Si está
  // vacío, no matcheó nada — venta inexistente O de otra empresa. Throw
  // loud para detectar tampering en lugar de silent no-op.
  const { data, error } = await supabase
    .from('ventas')
    .update({
      estado_facturacion_afip: nuevoEstado,
      ultimo_request_log_id: motivo.requestLogId,
      ultimo_error_facturacion: motivo.errorMensaje,
      ultimo_intento_facturacion_at: new Date().toISOString(),
    })
    .eq('id', ventaId)
    .eq('empresa_id', empresaId)
    .select('id')

  if (error) {
    throw new Error(
      `No se pudo marcar venta ${ventaId} con falla de facturación: ${error.message}`,
    )
  }
  if (!data || data.length === 0) {
    throw new Error(
      `Venta ${ventaId} no encontrada o no pertenece a empresa ${empresaId}`,
    )
  }
}

/**
 * Marca una venta como emitida exitosamente. Limpia error/intento previos
 * (porque ya no hay incidente que mostrar al admin).
 */
export async function marcarVentaEmitida(
  params: ParametrosMarcarEmitida,
): Promise<void> {
  const { ventaId, empresaId, requestLogId } = params
  const supabase = createAdminClient()

  // Defense in depth: filtro doble (id + empresa_id) y throw si no hubo
  // match. Ver doc en marcarVentaFallaFacturacion.
  const { data, error } = await supabase
    .from('ventas')
    .update({
      estado_facturacion_afip: 'emitida',
      ultimo_request_log_id: requestLogId,
      ultimo_error_facturacion: null,
      ultimo_intento_facturacion_at: new Date().toISOString(),
    })
    .eq('id', ventaId)
    .eq('empresa_id', empresaId)
    .select('id')

  if (error) {
    throw new Error(
      `No se pudo marcar venta ${ventaId} como emitida: ${error.message}`,
    )
  }
  if (!data || data.length === 0) {
    throw new Error(
      `Venta ${ventaId} no encontrada o no pertenece a empresa ${empresaId}`,
    )
  }
}
