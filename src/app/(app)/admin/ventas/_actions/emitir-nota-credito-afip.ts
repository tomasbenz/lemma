'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import { afip } from '@/lib/afip'
import type {
  AlicuotaIva,
  CondIvaReceptor,
  ComprobanteAsociadoWsfe,
  DatosFacturaInput,
  ItemFacturado,
  ReceptorFactura,
  TipoFacturaAfip,
} from '@/lib/afip'
import { descomponerFactura } from '@/lib/afip/calculos'

type ResultadoEmisionNC =
  | { ok: true; notaCreditoId: string; cae: string; numero: number }
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
 * Emite una Nota de Crédito AFIP asociada a una factura aprobada existente.
 *
 * Flujo:
 * 1. Trae factura original + venta + cliente + items
 * 2. Valida: factura aprobada, sin NC previa, permisos, empresa
 * 3. Reconstruye items prorrateados (mismo factor que emisión original)
 * 4. Determina tipoFactura NC según tipo de la factura original (A → NC A; B/C → NC B)
 * 5. Inserta registro NC en facturas_afip con factura_asociada_id
 * 6. Llama al adapter con comprobanteAsociado (shape wsfe)
 * 7. Si OK: actualiza NC con CAE + marca factura original como anulada_por_nc
 * 8. Si falla: marca NC como rechazada; la factura original NO se toca
 *
 * Atomicidad: si AFIP rechaza, la factura original sigue activa. El registro
 * de NC se persiste con estado 'rechazada' para auditoría.
 *
 * @param facturaOriginalId UUID de la factura aprobada que se quiere anular
 * @param motivo Texto que va al raw_response.motivo (auditoría)
 */
export async function emitirNotaCreditoAfip(
  facturaOriginalId: string,
  motivo: string,
): Promise<ResultadoEmisionNC> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }
    // Defense in depth sobre RLS: sin empresa_id no hay factura consultable.
    // Mismo mensaje genérico que "la factura no existe".
    if (!user.empresa_id) return { ok: false, error: 'La factura no existe' }

    const motivoLimpio = motivo?.trim() ?? ''
    if (!motivoLimpio) return { ok: false, error: 'El motivo es obligatorio' }

    const supabase = await createClient()

    // ============================================================
    // 1. Traer la factura original
    // ============================================================
    const { data: facturaOriginal, error: errFactura } = await supabase
      .from('facturas_afip')
      .select(
        `
        id,
        venta_id,
        tipo_factura,
        punto_venta,
        numero_comprobante,
        cae,
        estado,
        factura_asociada_id
      `,
      )
      .eq('id', facturaOriginalId)
      .eq('empresa_id', user.empresa_id)
      .single()

    if (errFactura || !facturaOriginal) {
      return { ok: false, error: 'La factura no existe' }
    }

    // Hasta regenerar los tipos de Supabase tras la migration que agrega
    // 'factura_b' al enum tipo_factura, casteamos localmente al union
    // extendido para que TS narrowee correctamente.
    const tipoFacturaOriginal = facturaOriginal.tipo_factura as
      | 'factura_a'
      | 'factura_b'
      | 'factura_c'
      | 'nota_credito_a'
      | 'nota_credito_b'
      | 'nota_debito_a'
      | 'nota_debito_b'

    // ============================================================
    // 2. Validaciones de estado
    // ============================================================
    if (facturaOriginal.estado !== 'aprobada') {
      return {
        ok: false,
        error: `Solo se puede emitir NC sobre facturas aprobadas. Estado actual: ${facturaOriginal.estado}`,
      }
    }

    if (facturaOriginal.factura_asociada_id !== null) {
      return {
        ok: false,
        error:
          'No se puede emitir NC sobre una NC/ND. Solo sobre facturas originales.',
      }
    }

    // Factura A, B o C original soportan NC. NC para A se mapea a
    // nota_credito_a (cbteTipo 3); NC para B/C se mapea a nota_credito_b
    // (cbteTipo 8) en el bloque de derivación más abajo. NC/ND como
    // factura original no se permite (no se anula una NC con otra NC).
    if (
      tipoFacturaOriginal !== 'factura_a' &&
      tipoFacturaOriginal !== 'factura_b' &&
      tipoFacturaOriginal !== 'factura_c'
    ) {
      return {
        ok: false,
        error: `Tipo de factura ${tipoFacturaOriginal} no soporta emisión de NC`,
      }
    }

    if (!facturaOriginal.numero_comprobante) {
      return {
        ok: false,
        error: 'La factura original no tiene número de comprobante',
      }
    }

    // Idempotencia: ¿ya existe una NC aprobada para esta factura?
    const { data: ncPrevia } = await supabase
      .from('facturas_afip')
      .select('id, cae, numero_comprobante')
      .eq('factura_asociada_id', facturaOriginalId)
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'aprobada')
      .maybeSingle()

    if (ncPrevia) {
      return {
        ok: false,
        error: `Esta factura ya tiene una NC aprobada (N°${ncPrevia.numero_comprobante})`,
      }
    }

    // ============================================================
    // 3. Traer la venta + cliente
    // ============================================================
    const { data: venta, error: errVenta } = await supabase
      .from('ventas')
      .select(
        `
        id,
        monto_facturado,
        nombre_cliente_custom,
        cliente:clientes!ventas_cliente_id_fkey(razon_social, cuit, cond_iva)
      `,
      )
      .eq('id', facturaOriginal.venta_id)
      .eq('empresa_id', user.empresa_id)
      .single()

    if (errVenta || !venta) {
      return { ok: false, error: 'No se pudo recuperar la venta de la factura' }
    }

    // ============================================================
    // 4. Items de la venta (mismo source que emisión original)
    // ============================================================
    const { data: ventaItems, error: errItems } = await supabase
      .from('items_venta')
      .select(
        'producto_nombre, producto_sku, variante_sku, cantidad, precio_unitario_neto, subtotal_neto',
      )
      .eq('venta_id', venta.id)
      .eq('empresa_id', user.empresa_id)

    if (errItems || !ventaItems || ventaItems.length === 0) {
      return { ok: false, error: 'La venta no tiene items facturables' }
    }

    // ============================================================
    // 5. Reconstruir receptor (mismo patrón que emitirFacturaAfip)
    // ============================================================
    const clienteRaw = venta.cliente as
      | Array<{
          razon_social: string
          cuit: string | null
          cond_iva: 'RI' | 'MONO' | 'CF' | 'EX'
        }>
      | {
          razon_social: string
          cuit: string | null
          cond_iva: 'RI' | 'MONO' | 'CF' | 'EX'
        }
      | null
    const cliente = Array.isArray(clienteRaw)
      ? (clienteRaw[0] ?? null)
      : clienteRaw

    let receptor: ReceptorFactura | null
    if (!cliente) {
      // CF anónimo solo válido en NC B (mismo criterio que factura_b).
      if (
        tipoFacturaOriginal === 'factura_c' &&
        !venta.nombre_cliente_custom
      ) {
        receptor = null
      } else {
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
      receptor = tieneCuitValido
        ? {
            documento: { tipo: 80, nro: cuitNormalizado },
            razonSocial: cliente.razon_social,
            condIva,
          }
        : {
            documento: { tipo: 99, nro: '0' },
            razonSocial: cliente.razon_social,
            condIva,
          }
    }

    // ============================================================
    // 6. Items prorrateados (mismo factor que emisión original)
    // ============================================================
    const totalNetoItems = ventaItems.reduce(
      (acc, i) => acc + Number(i.subtotal_neto),
      0,
    )
    if (totalNetoItems <= 0) {
      return { ok: false, error: 'Total neto de items es cero o negativo' }
    }
    const factor = venta.monto_facturado / totalNetoItems

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
        error: `Discrepancia en proporción de items: ${diferencia}`,
      }
    }
    if (diferencia !== 0 && items.length > 0) {
      const last = items[items.length - 1]
      last.subtotalFacturado = round2(last.subtotalFacturado + diferencia)
    }

    // ============================================================
    // 7. Tipo de NC + comprobante asociado + alícuotas
    // ============================================================
    const tipoNcInterno: TipoFacturaAfip =
      tipoFacturaOriginal === 'factura_a'
        ? 'nota_credito_a'
        : 'nota_credito_b'

    // cbteTipo de la factura original que va al CbtesAsoc
    const tipoFacturaOriginalCbteTipo: 1 | 6 =
      tipoFacturaOriginal === 'factura_a' ? 1 : 6

    const config = await obtenerConfiguracion()
    const cuitEmisor = config.cuit?.replace(/-/g, '') ?? ''
    if (cuitEmisor.length !== 11) {
      return { ok: false, error: 'CUIT del emisor no configurado correctamente' }
    }

    const comprobanteAsociado: ComprobanteAsociadoWsfe = {
      tipo: tipoFacturaOriginalCbteTipo,
      puntoVenta: facturaOriginal.punto_venta,
      numero: facturaOriginal.numero_comprobante,
      cuit: cuitEmisor,
    }

    // Descomposición IVA: para A y B se divide por 1.21 (mismo criterio
    // que emitirFacturaAfip). descomponerFactura soporta los 3 tipos
    // (A, B, C) nativamente. tipoFacturaOriginal está narroweado a
    // factura_a | factura_b | factura_c por el guard de líneas 131-133.
    const { netoGravado, iva } = descomponerFactura(
      venta.monto_facturado,
      tipoFacturaOriginal,
    )
    const alicuotas: AlicuotaIva[] = [
      { id: 5, baseImp: netoGravado, importe: iva },
    ]

    // ============================================================
    // 8. Insertar registro de NC en facturas_afip
    // ============================================================
    const { data: ncNueva, error: errInsertNc } = await supabase
      .from('facturas_afip')
      .insert({
        venta_id: venta.id,
        empresa_id: user.empresa_id,
        tipo_factura: tipoNcInterno,
        punto_venta: facturaOriginal.punto_venta,
        estado: 'pendiente',
        intentos: 1,
        factura_asociada_id: facturaOriginalId,
      } as never)
      .select('id')
      .single()

    if (errInsertNc || !ncNueva) {
      return {
        ok: false,
        error: errInsertNc?.message ?? 'No se pudo crear registro de NC',
      }
    }

    const ncId = ncNueva.id

    // ============================================================
    // 9. Llamar al adapter AFIP
    // ============================================================
    const payload: DatosFacturaInput = {
      empresaId: user.empresa_id,
      ventaId: venta.id,
      tipoFactura: tipoNcInterno,
      puntoVenta: facturaOriginal.punto_venta,
      concepto: 1, // productos
      fechaEmision: new Date().toISOString().split('T')[0],
      receptor,
      items,
      alicuotas,
      montoNetoGravado: netoGravado,
      montoIva: iva,
      montoTotal: venta.monto_facturado,
      comprobanteAsociado,
    }

    const resultado = await afip.emitir(payload)

    // ============================================================
    // 10. Persistir resultado
    // ============================================================
    if (!resultado.ok) {
      // Persistencia del estado rechazada para la NC. Mismo criterio
      // que emitirFacturaAfip: no hay CAE que preservar, solo detalle
      // de auditoría. Fallback a estado='error' si el UPDATE completo
      // falla.
      const { error: errPersistRechazada } = await supabase
        .from('facturas_afip')
        .update({
          estado: 'rechazada',
          error_mensaje: resultado.error,
          raw_response: resultado.rawResponse ?? null,
        } as never)
        .eq('id', ncId)
        .eq('empresa_id', user.empresa_id)

      if (errPersistRechazada) {
        console.error('[emitirNotaCreditoAfip] UPDATE rechazada falló (intento 1):', {
          ncId,
          facturaOriginalId,
          error: errPersistRechazada,
          afipError: resultado.error,
        })

        const { error: errPersistFallback } = await supabase
          .from('facturas_afip')
          .update({
            estado: 'error',
            error_mensaje: `AFIP rechazó NC: ${resultado.error}. UPDATE rechazada también falló: ${errPersistRechazada.message ?? errPersistRechazada}`,
          } as never)
          .eq('id', ncId)
          .eq('empresa_id', user.empresa_id)

        if (errPersistFallback) {
          console.error(
            '[emitirNotaCreditoAfip] CRÍTICO: ni el fallback de UPDATE error funcionó:',
            errPersistFallback,
          )
        }
      }

      revalidatePath(`/admin/ventas/${venta.id}`)
      return { ok: false, error: resultado.error }
    }

    // OK: actualizar NC con CAE + motivo en raw_response (auditoría).
    const rawConObservaciones: Record<string, unknown> = resultado.observaciones
      ? {
          ...resultado.rawResponse,
          observaciones: resultado.observaciones,
          motivo: motivoLimpio,
        }
      : { ...resultado.rawResponse, motivo: motivoLimpio }

    // Persistencia robusta del CAE de NC.
    // AFIP ya aprobo. Si el UPDATE falla, la NC existe fiscalmente
    // pero quedaria sin CAE en DB. Reintentamos una vez; si tambien
    // falla, marcamos 'aprobada_sin_persistir' y devolvemos error
    // sin tocar la factura original (sigue 'aprobada' — el admin
    // tiene que reconciliar manualmente).
    const datosPersistirNc = {
      estado: 'aprobada',
      cae: resultado.cae,
      cae_vencimiento: resultado.caeVencimiento,
      numero_comprobante: resultado.numeroComprobante,
      raw_response: rawConObservaciones,
      error_mensaje: null,
    }

    const { error: errUpdateNc1 } = await supabase
      .from('facturas_afip')
      .update(datosPersistirNc as never)
      .eq('id', ncId)
      .eq('empresa_id', user.empresa_id)

    if (errUpdateNc1) {
      console.error('[emitirNotaCreditoAfip] UPDATE persistencia NC falló (intento 1):', {
        ncId,
        facturaOriginalId,
        cae: resultado.cae,
        error: errUpdateNc1,
      })

      const { error: errUpdateNc2 } = await supabase
        .from('facturas_afip')
        .update(datosPersistirNc as never)
        .eq('id', ncId)
        .eq('empresa_id', user.empresa_id)

      if (errUpdateNc2) {
        console.error('[emitirNotaCreditoAfip] UPDATE persistencia NC falló (intento 2):', errUpdateNc2)

        const { error: errFallback } = await supabase
          .from('facturas_afip')
          .update({ estado: 'aprobada_sin_persistir' } as never)
          .eq('id', ncId)
          .eq('empresa_id', user.empresa_id)

        if (errFallback) {
          console.error('[emitirNotaCreditoAfip] CRÍTICO: fallback NC tampoco funcionó:', errFallback)
        }

        return {
          ok: false,
          error: `NC aprobada por AFIP (CAE: ${resultado.cae}, número: ${resultado.numeroComprobante}) pero no pudo persistirse en DB. La factura original NO se marcó como anulada. Contactar soporte para reconciliación manual. ncId: ${ncId}`,
        }
      }
    }

    // Marcar factura original como anulada_por_nc.
    // Defense in depth: ademas de la PK, scope por empresa_id.
    // Si este UPDATE falla, NO abortamos: la NC ya esta persistida con
    // CAE, eso es lo critico fiscalmente. El estado inconsistente es:
    // factura original sigue 'aprobada' pero con NC apuntandola. La UI
    // debe detectar la relacion y mostrar el estado real, no depender
    // solo del campo 'estado' de la factura original.
    const { error: errMarcarOriginal } = await supabase
      .from('facturas_afip')
      .update({ estado: 'anulada_por_nc' } as never)
      .eq('id', facturaOriginalId)
      .eq('empresa_id', user.empresa_id)

    if (errMarcarOriginal) {
      console.error(
        '[emitirNotaCreditoAfip] No se pudo marcar factura original como anulada_por_nc:',
        errMarcarOriginal,
      )
    }

    revalidatePath(`/admin/ventas/${venta.id}`)
    revalidatePath('/admin/ventas')

    return {
      ok: true,
      notaCreditoId: ncId,
      cae: resultado.cae,
      numero: resultado.numeroComprobante,
    }
  } catch (err) {
    console.error('[emitirNotaCreditoAfip]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
