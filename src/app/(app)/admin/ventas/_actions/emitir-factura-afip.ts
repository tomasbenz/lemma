'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import { afip } from '@/lib/afip'
import type {
  AlicuotaIva,
  CondIvaReceptor,
  DatosFacturaInput,
  ItemFacturado,
  ReceptorFactura,
  TipoFacturaAfip,
} from '@/lib/afip'
import { descomponerFactura } from '@/lib/afip/calculos'
import { marcarVentaFallaFacturacion } from '@/lib/afip/recovery'
import { esErrorReintentableAfip } from '@/lib/afip/retry'
import { detectarErrorUniqueConstraint } from '@/lib/afip/postgres-errors'

type ResultadoEmision =
  | {
      ok: true
      facturaId: string
      cae: string
      numero: number
      /**
       * true cuando la venta ya tenía una factura original fiscalmente viva
       * (aprobada / aprobada_sin_persistir / anulada_por_nc) y devolvimos
       * los datos existentes sin llamar a AFIP. Útil para que la UI
       * distinga "se acaba de facturar" vs "ya estaba facturada".
       */
      yaExistente?: boolean
    }
  | { ok: false; error: string }

// Mapeo de cond_iva legacy de la tabla `clientes` al CondicionIVAReceptorId de AFIP.
const COND_IVA_MAP: Record<'RI' | 'MONO' | 'CF' | 'EX', CondIvaReceptor> = {
  RI: 1,
  MONO: 6,
  CF: 5,
  EX: 4,
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Emite (o reintenta) una factura AFIP para una venta.
 *
 * Flujo:
 * 1. Trae la venta + cliente + items
 * 2. Determina tipoFactura real según cond_iva del receptor (A, B; C bloquea para RI)
 * 3. Aplica regla del cliente: cada item se proporciona a monto_facturado
 * 4. Crea/actualiza registro en facturas_afip (UPDATE en reintento, no INSERT nuevo)
 * 5. Llama al adaptador AFIP
 * 6. Guarda resultado (cae + vencimiento + raw_response)
 */
export async function emitirFacturaAfip(
  ventaId: string,
): Promise<ResultadoEmision> {
  // Capturas para que el catch general pueda invocar recovery aún si el
  // throw ocurre después de obtener el user. Recovery requiere empresaId
  // y, si lo tenemos, el requestLogId del último intento.
  let userEmpresaIdParaCatch: string | null = null
  let requestLogId: number | null = null

  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }

    // Defense in depth sobre RLS: sin empresa_id no hay venta consultable.
    // Mismo mensaje genérico que "la venta no existe".
    if (!user.empresa_id) return { ok: false, error: 'La venta no existe' }

    userEmpresaIdParaCatch = user.empresa_id

    const supabase = await createClient()

    // Configuración: punto de venta
    const config = await obtenerConfiguracion()
    const puntoVenta = config.puntos_venta?.[0] ?? config.punto_venta_default ?? 1

    // 1. Traer la venta con el cliente
    const { data: venta, error: errVenta } = await supabase
      .from('ventas')
      .select(
        `
        id,
        tipo_factura,
        monto_facturado,
        estado,
        nombre_cliente_custom,
        created_at,
        cliente:clientes!ventas_cliente_id_fkey(razon_social, cuit, cond_iva)
      `,
      )
      .eq('id', ventaId)
      .eq('empresa_id', user.empresa_id)
      .single()

    if (errVenta || !venta) {
      return { ok: false, error: 'La venta no existe' }
    }

    if (venta.estado === 'anulada') {
      return { ok: false, error: 'No se puede facturar una venta anulada' }
    }

    // Hasta regenerar los tipos de Supabase tras la migration que agrega
    // 'factura_b' al enum tipo_factura, casteamos localmente al union
    // extendido para que TS narrowee correctamente.
    const tipoFacturaVenta = venta.tipo_factura as
      | 'sin_factura'
      | 'factura_a'
      | 'factura_b'
      | 'factura_c'
      | 'nota_credito_a'
      | 'nota_credito_b'
      | 'nota_debito_a'
      | 'nota_debito_b'

    if (
      tipoFacturaVenta !== 'factura_a' &&
      tipoFacturaVenta !== 'factura_b' &&
      tipoFacturaVenta !== 'factura_c'
    ) {
      return {
        ok: false,
        error: 'La venta no está marcada con factura A, B o C',
      }
    }

    // Pre-check: ¿esta venta ya tiene una factura ORIGINAL fiscalmente viva?
    //
    // "Viva" = aprobada / aprobada_sin_persistir / anulada_por_nc. Estos
    // son los mismos estados que el UNIQUE INDEX parcial cubre. Si hay una,
    // no llamamos a AFIP — devolvemos la existente con flag `yaExistente`.
    //
    // factura_asociada_id IS NULL filtra NCs (que pueden ser N por venta).
    //
    // Esto NO elimina la race condition entre el SELECT y el INSERT de la
    // fila 'pendiente' (dos clicks simultáneos siguen pasando ambos por
    // este pre-check). El backstop real es:
    //   1) El UNIQUE INDEX en DB: el segundo UPDATE a 'aprobada' falla con
    //      SQLSTATE 23505 — manejado abajo.
    //   2) La idempotencia AFIP en wsfe/index.ts (FECompConsultar antes
    //      de FECAESolicitar): si los dos requests llegan a AFIP, el
    //      segundo recibe el CAE existente del primero.
    const { data: facturaExistente } = await supabase
      .from('facturas_afip')
      .select('id, cae, estado, numero_comprobante')
      .eq('venta_id', ventaId)
      .eq('empresa_id', user.empresa_id)
      .is('factura_asociada_id', null)
      .in('estado', ['aprobada', 'aprobada_sin_persistir', 'anulada_por_nc'])
      .maybeSingle()

    if (facturaExistente) {
      return {
        ok: true,
        facturaId: facturaExistente.id,
        cae: facturaExistente.cae ?? '',
        numero: facturaExistente.numero_comprobante ?? 0,
        yaExistente: true,
      }
    }

    // Validar monto a facturar
    if (venta.monto_facturado <= 0) {
      return {
        ok: false,
        error: 'El monto a facturar debe ser mayor a cero',
      }
    }

    // 2. Traer items de la venta
    const { data: ventaItems, error: errItems } = await supabase
      .from('items_venta')
      .select(
        'producto_nombre, producto_sku, variante_sku, cantidad, precio_unitario_neto, subtotal_neto',
      )
      .eq('venta_id', venta.id)
      .eq('empresa_id', user.empresa_id)

    if (errItems) {
      return { ok: false, error: 'No se pudieron leer los items de la venta' }
    }
    if (!ventaItems || ventaItems.length === 0) {
      return {
        ok: false,
        error: 'La venta no tiene items registrados, no se puede facturar',
      }
    }

    // Normalizar cliente (Supabase puede devolverlo como array o como objeto)
    const clienteRaw = venta.cliente as
      | Array<{
          razon_social: string
          cuit: string | null
          cond_iva: 'RI' | 'MONO' | 'CF' | 'EX'
        }>
      | { razon_social: string; cuit: string | null; cond_iva: 'RI' | 'MONO' | 'CF' | 'EX' }
      | null
    const cliente = Array.isArray(clienteRaw)
      ? (clienteRaw[0] ?? null)
      : clienteRaw

    // 3. Determinar tipoFactura real
    let tipoFactura: TipoFacturaAfip
    if (tipoFacturaVenta === 'factura_a') {
      if (!cliente || !cliente.cuit) {
        return { ok: false, error: 'Factura A requiere cliente con CUIT' }
      }
      if (cliente.cond_iva !== 'RI' && cliente.cond_iva !== 'MONO') {
        return {
          ok: false,
          error: `El cliente ${cliente.razon_social} (cond IVA: ${cliente.cond_iva}) no puede recibir Factura A. Solo RI y Monotributo.`,
        }
      }
      tipoFactura = 'factura_a'
    } else if (tipoFacturaVenta === 'factura_b') {
      // RI emitiendo B. No requiere validacion extra: B se puede emitir a
      // CF/MONO/EX o sin cliente (CF anonimo). Si receptor es RI con CUIT,
      // el flujo correcto seria A, pero aceptamos B (caso raro pero valido
      // fiscalmente: RI puede emitir B a otro RI por simplificacion operativa).
      tipoFactura = 'factura_b'
    } else {
      // venta.tipo_factura === 'factura_c' — backcompat de venta historica.
      // Un emisor RI NO emite C. Si receptor es CF/EX o no existe → B.
      // Si receptor es RI/MONO → bloquear (deberia ser A, no C).
      if (cliente && (cliente.cond_iva === 'RI' || cliente.cond_iva === 'MONO')) {
        return {
          ok: false,
          error: `El cliente ${cliente.razon_social} es ${cliente.cond_iva}, debería emitirse Factura A en lugar de C`,
        }
      }
      tipoFactura = 'factura_b'

      // Sincronizar DB: la venta tenia tipo_factura='factura_c' pero
      // emitimos B. Actualizamos para que la DB refleje la realidad.
      // Si el UPDATE falla, no abortamos — la emision va de todas formas.
      const { error: errSync } = await supabase
        .from('ventas')
        .update({ tipo_factura: 'factura_b' } as never)
        .eq('id', venta.id)
        .eq('empresa_id', user.empresa_id)
      if (errSync) {
        console.error('[emitirFacturaAfip] No se pudo sincronizar tipo_factura C→B:', errSync)
      }
    }

    // 4. Construir receptor
    let receptor: ReceptorFactura | null
    if (!cliente) {
      if (tipoFactura === 'factura_b' && !venta.nombre_cliente_custom) {
        // CF anónimo total
        receptor = null
      } else {
        // Sin cliente pero con nombre custom (o por seguridad si llegara aquí en otro tipo)
        receptor = {
          documento: { tipo: 99, nro: '0' },
          razonSocial: venta.nombre_cliente_custom ?? 'Consumidor Final',
          condIva: 5,
        }
      }
    } else {
      const condIva = COND_IVA_MAP[cliente.cond_iva]
      const cuitNormalizado = cliente.cuit?.replace(/-/g, '') ?? ''
      const tieneCuitValido = cuitNormalizado.length === 11

      if (tieneCuitValido) {
        receptor = {
          documento: { tipo: 80, nro: cuitNormalizado },
          razonSocial: cliente.razon_social,
          condIva,
        }
      } else {
        // Sin CUIT válido. Para A ya bloqueamos arriba; acá solo cae B.
        receptor = {
          documento: { tipo: 99, nro: '0' },
          razonSocial: cliente.razon_social,
          condIva,
        }
      }
    }

    // 5. Calcular factor de proporción
    const totalNetoItems = ventaItems.reduce(
      (acc, i) => acc + Number(i.subtotal_neto),
      0,
    )
    if (totalNetoItems <= 0) {
      return {
        ok: false,
        error: 'Total neto de items es cero o negativo',
      }
    }
    const factor = venta.monto_facturado / totalNetoItems

    // 6. Construir items facturados con la regla del cliente aplicada
    const items: ItemFacturado[] = ventaItems.map((i) => {
      const precioUnitarioFacturado = round2(
        Number(i.precio_unitario_neto) * factor,
      )
      const subtotalCalculado = round2(i.cantidad * precioUnitarioFacturado)
      return {
        productoNombre: i.producto_nombre,
        productoSku: i.producto_sku,
        varianteSku: i.variante_sku,
        cantidad: i.cantidad,
        precioUnitarioFacturado,
        subtotalFacturado: subtotalCalculado,
      }
    })

    // Ajuste fino: el último item absorbe centavos de redondeo
    const sumaActual = items.reduce((acc, i) => acc + i.subtotalFacturado, 0)
    const diferencia = round2(venta.monto_facturado - sumaActual)
    if (Math.abs(diferencia) > 0.05) {
      return {
        ok: false,
        error: `Discrepancia en proporción de items: ${diferencia}. Revisar datos de la venta.`,
      }
    }
    if (diferencia !== 0) {
      const last = items[items.length - 1]
      last.subtotalFacturado = round2(last.subtotalFacturado + diferencia)
      // No tocamos precioUnitarioFacturado del último: la invariante se relaja para él
    }

    // 7. Calcular alícuotas
    // descomponerFactura soporta factura_a, factura_b y factura_c nativamente.
    // A y B usan misma lógica (dividir por 1.21); C no descompone IVA.
    let alicuotas: AlicuotaIva[]
    let montoNetoGravado: number
    let montoIva: number
    if (tipoFactura === 'factura_a' || tipoFactura === 'factura_b') {
      const { netoGravado, iva } = descomponerFactura(
        venta.monto_facturado,
        tipoFactura,
      )
      alicuotas = [{ id: 5, baseImp: netoGravado, importe: iva }]
      montoNetoGravado = netoGravado
      montoIva = iva
    } else {
      // factura_c (no aplica para emisores RI, pero queda por compatibilidad)
      alicuotas = []
      montoNetoGravado = venta.monto_facturado
      montoIva = 0
    }

    // 8. Construir payload
    const payload: DatosFacturaInput = {
      empresaId: user.empresa_id,
      // Callback que captura el id de afip_request_log para persistirlo
      // en `ventas.ultimo_request_log_id` vía recovery.
      onRequestLogged: (id) => {
        requestLogId = id
      },
      ventaId: venta.id,
      tipoFactura,
      puntoVenta,
      concepto: 1, // productos
      fechaEmision: new Date().toISOString().split('T')[0],
      receptor,
      items,
      alicuotas,
      montoNetoGravado,
      montoIva,
      montoTotal: venta.monto_facturado,
    }

    // 9. Crear o reutilizar registro en facturas_afip
    // Bug previo: cada reintento hacía INSERT con intentos=1. Ahora si existe
    // una previa fallida la UPDATE-amos para mantener trazabilidad acumulativa.
    const { data: facturaPrevia } = await supabase
      .from('facturas_afip')
      .select('id, intentos, estado')
      .eq('venta_id', venta.id)
      .eq('empresa_id', user.empresa_id)
      .in('estado', ['rechazada', 'error'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let facturaId: string

    if (facturaPrevia) {
      const { error: errUpd } = await supabase
        .from('facturas_afip')
        .update({
          estado: 'pendiente',
          intentos: facturaPrevia.intentos + 1,
          error_mensaje: null,
        } as never)
        .eq('id', facturaPrevia.id)
      if (errUpd) {
        return { ok: false, error: 'No se pudo actualizar factura previa' }
      }
      facturaId = facturaPrevia.id
    } else {
      const { data: facturaNueva, error: errInsert } = await supabase
        .from('facturas_afip')
        .insert({
          venta_id: venta.id,
          empresa_id: user.empresa_id,
          // Usar el tipoFactura real (derivado), NO venta.tipo_factura.
          // Si la venta era factura_c y la convertimos a factura_b en runtime,
          // venta.tipo_factura sigue siendo 'factura_c' en esta variable local
          // (la versión leída antes del UPDATE de conversión). Persistir
          // tipoFactura asegura coherencia con lo que efectivamente se emitió.
          tipo_factura: tipoFactura,
          punto_venta: puntoVenta,
          estado: 'pendiente',
          intentos: 1,
        } as never)
        .select('id')
        .single()
      if (errInsert || !facturaNueva) {
        return {
          ok: false,
          error: errInsert?.message ?? 'No se pudo crear registro de factura',
        }
      }
      facturaId = facturaNueva.id
    }

    // 10. Llamar al adaptador AFIP
    const resultado = await afip.emitir(payload)

    // 11. Persistir resultado
    if (!resultado.ok) {
      // Persistencia del estado rechazada. A diferencia del path
      // aprobada, no hay CAE que preservar — AFIP rechazó. Si DB
      // falla, solo perdemos detalle de auditoría. Intentamos UPDATE
      // completo; si falla, UPDATE de fallback con solo estado+mensaje
      // (sin raw_response, que es jsonb grande y puede ser la causa
      // del fallo). Si el fallback también falla, log crítico.
      const { error: errPersistRechazada } = await supabase
        .from('facturas_afip')
        .update({
          estado: 'rechazada',
          error_mensaje: resultado.error,
          raw_response: resultado.rawResponse ?? null,
        } as never)
        .eq('id', facturaId)
        .eq('empresa_id', user.empresa_id)

      if (errPersistRechazada) {
        console.error('[emitirFacturaAfip] UPDATE rechazada falló (intento 1):', {
          facturaId,
          ventaId,
          error: errPersistRechazada,
          afipError: resultado.error,
        })

        const { error: errPersistFallback } = await supabase
          .from('facturas_afip')
          .update({
            estado: 'error',
            error_mensaje: `AFIP rechazó: ${resultado.error}. UPDATE rechazada también falló: ${errPersistRechazada.message ?? errPersistRechazada}`,
          } as never)
          .eq('id', facturaId)
          .eq('empresa_id', user.empresa_id)

        if (errPersistFallback) {
          console.error(
            '[emitirFacturaAfip] CRÍTICO: ni el fallback de UPDATE error funcionó:',
            errPersistFallback,
          )
        }
      }

      // Marcar la venta. Si llegamos acá con resultado.ok=false, el
      // adapter ya hizo el retry interno (3 intentos sobre llamadas
      // reintentables) y nos devolvió un error definitivo. Marcamos
      // como NO reintentable para que el admin tenga que actuar
      // (revisar datos, cambiar tipo de factura, anular venta).
      await marcarVentaFallaFacturacion({
        ventaId: venta.id,
        empresaId: user.empresa_id,
        motivo: {
          requestLogId,
          errorMensaje: resultado.error,
          esReintentable: false,
        },
      })

      revalidatePath(`/admin/ventas/${ventaId}`)
      return { ok: false, error: resultado.error }
    }

    // Si hubo observaciones (warnings que no rechazan), las dejamos en raw_response
    // para compliance.
    const rawConObservaciones: Record<string, unknown> = resultado.observaciones
      ? { ...resultado.rawResponse, observaciones: resultado.observaciones }
      : resultado.rawResponse

    // Persistencia atómica del CAE.
    //
    // La RPC `persistir_cae_y_marcar_emitida` envuelve UPDATE facturas_afip
    // (CAE + estado=aprobada) + UPDATE ventas (estado_facturacion_afip=emitida)
    // en una transacción PL/pgSQL. Si cualquiera falla, rollback automático —
    // evita la inconsistencia "CAE persistido pero venta pendiente" que tenía
    // el flow anterior con dos UPDATEs secuenciales.
    //
    // Reintento: 1 sola vez ante error transitorio (red entre app y PG).
    // No vale reintentar 23505 (UNIQUE es estructural) ni errores de
    // "no encontrado" (factura/venta de otra empresa).
    const argsRpc = {
      p_factura_id: facturaId,
      p_venta_id: venta.id,
      p_empresa_id: user.empresa_id,
      p_cae: resultado.cae,
      p_cae_vencimiento: resultado.caeVencimiento,
      p_numero_comprobante: resultado.numeroComprobante,
      p_raw_response: rawConObservaciones,
      p_request_log_id: requestLogId,
    }

    // Cast del nombre de la RPC: los tipos generados en database.ts
    // todavía no la incluyen — se regenera con `npm run db:types` después
    // de aplicar la migration 20260513130000 en Supabase Cloud.
    const { error: errRpc1 } = await supabase.rpc(
      'persistir_cae_y_marcar_emitida' as never,
      argsRpc as never,
    )

    if (errRpc1) {
      console.error(
        '[emitirFacturaAfip] RPC persistir_cae_y_marcar_emitida falló (intento 1):',
        { facturaId, ventaId, cae: resultado.cae, error: errRpc1 },
      )

      // Violación del UNIQUE INDEX (SQLSTATE 23505) significa que entre
      // nuestro pre-check y este UPDATE, OTRO request ya persistió una
      // factura original viva para esta venta. AFIP emitió 2 comprobantes:
      // el del primer request ganó la persistencia; el nuestro es huérfano
      // fiscal (CAE válido en AFIP sin venta asociada en DB). Requiere NC
      // manual para reconciliar — no podemos auto-NC sin contexto del admin.
      //
      // La RPC ya hizo rollback (ni facturas_afip ni ventas se tocaron).
      // Marcamos la fila pendiente como 'rechazada' con mensaje específico
      // — este UPDATE NO entra al UNIQUE (rechazada no está en el WHERE).
      if (detectarErrorUniqueConstraint(errRpc1)) {
        console.error(
          '[emitirFacturaAfip] Race condition detectada (UNIQUE 23505):',
          { facturaId, ventaId, caeHuerfano: resultado.cae },
        )
        await supabase
          .from('facturas_afip')
          .update({
            estado: 'rechazada',
            error_mensaje: `Race condition: otra emisión ya persistió la factura original de esta venta. CAE huérfano en AFIP que requiere NC manual para reconciliación: ${resultado.cae} (vto ${resultado.caeVencimiento}, número ${resultado.numeroComprobante}).`,
            raw_response: rawConObservaciones,
          } as never)
          .eq('id', facturaId)
          .eq('empresa_id', user.empresa_id)

        await marcarVentaFallaFacturacion({
          ventaId: venta.id,
          empresaId: user.empresa_id,
          motivo: {
            requestLogId,
            errorMensaje: `Race condition: CAE huérfano ${resultado.cae} requiere NC manual`,
            esReintentable: false,
          },
        })

        revalidatePath(`/admin/ventas/${ventaId}`)
        return {
          ok: false,
          error: `Esta venta ya fue facturada por otro proceso. Se generó un CAE duplicado en AFIP (${resultado.cae}, vto ${resultado.caeVencimiento}, número ${resultado.numeroComprobante}) que requiere emisión de Nota de Crédito manual para limpieza fiscal.`,
        }
      }

      // Reintento de la RPC entera ante errores transitorios. Si en el
      // segundo intento sigue fallando, vamos al fallback 'aprobada_sin_persistir'.
      const { error: errRpc2 } = await supabase.rpc(
        'persistir_cae_y_marcar_emitida' as never,
        argsRpc as never,
      )

      if (errRpc2) {
        console.error(
          '[emitirFacturaAfip] RPC persistir_cae_y_marcar_emitida falló (intento 2):',
          errRpc2,
        )

        // El reintento también falló. AFIP ya tiene el CAE válido pero
        // nosotros no logramos persistirlo. Marcamos como
        // 'aprobada_sin_persistir' para reconciliación manual y devolvemos
        // error con todos los datos del CAE.
        //
        // Este UPDATE es directo (no RPC) porque la atomicidad ya no
        // importa: el primer UPDATE de la RPC nunca commiteó, y aprobada_sin_persistir
        // entra al UNIQUE igual que aprobada — si la race condition es la
        // causa, el SELECT del UNIQUE va a fallar también acá. No hay
        // forma de recuperar sin intervención manual.
        const { error: errFallback } = await supabase
          .from('facturas_afip')
          .update({ estado: 'aprobada_sin_persistir' } as never)
          .eq('id', facturaId)
          .eq('empresa_id', user.empresa_id)

        if (errFallback) {
          console.error(
            '[emitirFacturaAfip] CRÍTICO: ni siquiera el fallback funcionó:',
            errFallback,
          )
        }

        return {
          ok: false,
          error: `Factura aprobada por AFIP (CAE: ${resultado.cae}, vencimiento: ${resultado.caeVencimiento}, número: ${resultado.numeroComprobante}) pero no pudo persistirse en DB. Contactar soporte para reconciliación manual. facturaId: ${facturaId}`,
        }
      }
    }

    // La RPC ya marcó la venta como emitida atómicamente con el CAE.
    // (En el flow previo, esto era una llamada separada a marcarVentaEmitida.)

    revalidatePath(`/admin/ventas/${ventaId}`)
    revalidatePath('/admin/ventas')

    return {
      ok: true,
      facturaId,
      cae: resultado.cae,
      numero: resultado.numeroComprobante,
    }
  } catch (err) {
    console.error('[emitirFacturaAfip]', err)
    // Marcar la venta como falla incluso si el catch general atrapa.
    // Esto cubre errores que no vinieron del adapter (DB caída,
    // validación interna, etc.). Si no tenemos empresaId no podemos
    // actualizar (early return antes de capturarlo) — cae fuera.
    if (userEmpresaIdParaCatch) {
      try {
        await marcarVentaFallaFacturacion({
          ventaId,
          empresaId: userEmpresaIdParaCatch,
          motivo: {
            requestLogId,
            errorMensaje: err instanceof Error ? err.message : 'Error inesperado',
            esReintentable: esErrorReintentableAfip(err),
          },
        })
      } catch (recoveryErr) {
        console.error('[emitirFacturaAfip] recovery también falló', recoveryErr)
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
