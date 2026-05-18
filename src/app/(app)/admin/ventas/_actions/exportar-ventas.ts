// src/app/(app)/admin/ventas/_actions/exportar-ventas.ts
'use server'

import * as XLSX from 'xlsx'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { descomponerFactura } from '@/lib/afip/calculos'
import { formatAtributos } from '@/lib/format-atributos'

type ExportInput = {
  /** IDs específicas de ventas a exportar. Lo mandamos desde el client
   *  para que respete TODOS los filtros (URL + búsqueda live). */
  ids: string[]
}

type ExportResult =
  | { ok: true; filename: string; dataBase64: string }
  | { ok: false; error: string }

type VentaExport = {
  id: string
  numero: number
  created_at: string
  closed_at: string | null
  canal: string
  estado: string
  subtotal_neto: number
  descuento_total: number
  total: number
  recargo_factura_completa: boolean
  recargo_porcentaje_manual: number | null
  recargo_motivo: string | null
  tipo_factura: string
  monto_facturado: number
  nota_interna: string | null
  usuario_nombre: string
  cliente_razon_social: string
  items: Array<{
    producto_nombre: string
    producto_sku: string
    variante_sku: string
    variante_atributos: Record<string, unknown> | null
    cantidad: number
    precio_unitario_neto: number
    subtotal_neto: number
  }>
}

/** Tope de seguridad: si alguien intenta exportar 10k ventas, abortamos. */
const MAX_VENTAS_EXPORT = 5000

export async function exportarVentasExcel(
  input: ExportInput
): Promise<ExportResult> {
  try {
    const user = await getCurrentUser()
    if (!user) redirect('/login')
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'Sin permisos para exportar' }
    }

    const ids = (input?.ids ?? []).filter((s) => typeof s === 'string')

    if (ids.length === 0) {
      return { ok: false, error: 'No hay ventas seleccionadas para exportar' }
    }

    if (ids.length > MAX_VENTAS_EXPORT) {
      return {
        ok: false,
        error: `Demasiadas ventas (${ids.length}). Máximo ${MAX_VENTAS_EXPORT} por export.`,
      }
    }

    // Defense in depth sobre RLS: sin empresa_id no hay nada que exportar.
    // Mismo error genérico que "no se encontraron ventas".
    if (!user.empresa_id) {
      return { ok: false, error: 'No se encontraron ventas' }
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('ventas')
      .select(
        `
        id,
        numero,
        created_at,
        closed_at,
        canal,
        estado,
        subtotal_neto,
        descuento_total,
        total,
        recargo_factura_completa,
        recargo_porcentaje_manual,
        recargo_motivo,
        tipo_factura,
        monto_facturado,
        nota_interna,
        usuario:usuarios!ventas_usuario_id_fkey(nombre_completo, email),
        cliente:clientes!ventas_cliente_id_fkey(razon_social),
        items_venta(
          producto_nombre,
          producto_sku,
          variante_sku,
          variante_atributos,
          cantidad,
          precio_unitario_neto,
          subtotal_neto
        )
      `
      )
      .in('id', ids)
      .eq('empresa_id', user.empresa_id)
      .order('numero', { ascending: true })

    if (error) {
      console.error('[exportarVentasExcel] Error query:', error)
      return { ok: false, error: 'Error al obtener ventas' }
    }

    if (!data || data.length === 0) {
      return { ok: false, error: 'No se encontraron ventas' }
    }

    // Normalizar datos
    const ventas: VentaExport[] = data.map((v) => {
      const usuarioRaw = v.usuario as
        | { nombre_completo: string | null; email: string }
        | Array<{ nombre_completo: string | null; email: string }>
        | null
      const usuario = Array.isArray(usuarioRaw)
        ? (usuarioRaw[0] ?? null)
        : usuarioRaw

      const clienteRaw = v.cliente as
        | { razon_social: string }
        | Array<{ razon_social: string }>
        | null
      const cliente = Array.isArray(clienteRaw)
        ? (clienteRaw[0] ?? null)
        : clienteRaw

      return {
        id: v.id,
        numero: v.numero,
        created_at: v.created_at,
        closed_at: v.closed_at,
        canal: v.canal,
        estado: v.estado,
        subtotal_neto: v.subtotal_neto,
        descuento_total: v.descuento_total,
        total: v.total,
        recargo_factura_completa: v.recargo_factura_completa,
        recargo_porcentaje_manual: v.recargo_porcentaje_manual,
        recargo_motivo: v.recargo_motivo,
        tipo_factura: v.tipo_factura,
        monto_facturado: v.monto_facturado,
        nota_interna: v.nota_interna,
        usuario_nombre:
          usuario?.nombre_completo ?? usuario?.email ?? 'Sin vendedor',
        cliente_razon_social: cliente?.razon_social ?? 'Consumidor final',
        items: (v.items_venta ?? []) as VentaExport['items'],
      }
    })

    // === SHEET 1: VENTAS ===
    // Bajo el modelo nuevo de IVA: precios netos, sin sumar 21% al cobrar.
    // - "Total cobrado" = lo que pagó el cliente (= subtotal − descuento, +10,5% si recargo)
    // - "Recargo 10,5%" = monto del recargo cuando recargo_factura_completa = true
    // - "Neto facturado" / "IVA 21% facturado" = descomposición de monto_facturado
    //   (solo cuando hay factura emitida; en sin_factura quedan vacíos)
    const sheetVentas = ventas.map((v) => {
      const cantidadItems = v.items.reduce((sum, i) => sum + i.cantidad, 0)
      const recargoMonto = v.recargo_factura_completa
        ? round2(v.total - (v.subtotal_neto - v.descuento_total))
        : 0
      const recargoManualMonto =
        v.recargo_porcentaje_manual !== null
          ? round2(v.total - (v.subtotal_neto - v.descuento_total))
          : 0
      const tieneIva =
        v.tipo_factura === 'factura_a' ||
        v.tipo_factura === 'factura_b' ||
        v.tipo_factura === 'factura_c'
      const desglose = tieneIva
        ? descomponerFactura(
            v.monto_facturado,
            v.tipo_factura as 'factura_a' | 'factura_b' | 'factura_c',
          )
        : null

      return {
        'N°': v.numero,
        Fecha: formatearFecha(v.created_at),
        Hora: formatearHora(v.created_at),
        Vendedor: v.usuario_nombre,
        Cliente: v.cliente_razon_social,
        Items: cantidadItems,
        'Subtotal neto': round2(v.subtotal_neto),
        Descuento: round2(v.descuento_total),
        'Recargo 10,5%': recargoMonto,
        'Recargo manual %': v.recargo_porcentaje_manual ?? '',
        'Recargo manual $': recargoManualMonto,
        'Motivo recargo manual': v.recargo_motivo ?? '',
        'Total cobrado': round2(v.total),
        Factura: labelFactura(v.tipo_factura),
        'Monto facturado': round2(v.monto_facturado),
        'Neto facturado': desglose ? desglose.netoGravado : '',
        'IVA 21% facturado': desglose ? desglose.iva : '',
        Estado: labelEstado(v.estado),
        Canal: v.canal,
        'Nota interna': v.nota_interna ?? '',
      }
    })

    // Totales al final
    const totalRecargo = round2(
      ventas.reduce(
        (sum, v) =>
          sum +
          (v.recargo_factura_completa
            ? v.total - (v.subtotal_neto - v.descuento_total)
            : 0),
        0
      )
    )
    const totalRecargoManual = round2(
      ventas.reduce(
        (sum, v) =>
          sum +
          (v.recargo_porcentaje_manual !== null
            ? v.total - (v.subtotal_neto - v.descuento_total)
            : 0),
        0
      )
    )
    const totalNetoFacturado = round2(
      ventas.reduce((sum, v) => {
        if (
          v.tipo_factura !== 'factura_a' &&
          v.tipo_factura !== 'factura_b' &&
          v.tipo_factura !== 'factura_c'
        ) {
          return sum
        }
        return (
          sum +
          descomponerFactura(
            v.monto_facturado,
            v.tipo_factura as 'factura_a' | 'factura_b' | 'factura_c',
          ).netoGravado
        )
      }, 0)
    )
    const totalIvaFacturado = round2(
      ventas.reduce((sum, v) => {
        if (
          v.tipo_factura !== 'factura_a' &&
          v.tipo_factura !== 'factura_b' &&
          v.tipo_factura !== 'factura_c'
        ) {
          return sum
        }
        return (
          sum +
          descomponerFactura(
            v.monto_facturado,
            v.tipo_factura as 'factura_a' | 'factura_b' | 'factura_c',
          ).iva
        )
      }, 0)
    )

    const totales = {
      'N°': '' as string | number,
      Fecha: '',
      Hora: '',
      Vendedor: '',
      Cliente: 'TOTALES',
      Items: ventas.reduce(
        (sum, v) => sum + v.items.reduce((s, i) => s + i.cantidad, 0),
        0
      ),
      'Subtotal neto': round2(
        ventas.reduce((sum, v) => sum + v.subtotal_neto, 0)
      ),
      Descuento: round2(
        ventas.reduce((sum, v) => sum + v.descuento_total, 0)
      ),
      'Recargo 10,5%': totalRecargo,
      'Recargo manual %': '',
      'Recargo manual $': totalRecargoManual,
      'Motivo recargo manual': '',
      'Total cobrado': round2(ventas.reduce((sum, v) => sum + v.total, 0)),
      Factura: '',
      'Monto facturado': round2(
        ventas.reduce((sum, v) => sum + v.monto_facturado, 0)
      ),
      'Neto facturado': totalNetoFacturado,
      'IVA 21% facturado': totalIvaFacturado,
      Estado: '',
      Canal: '',
      'Nota interna': '',
    }
    sheetVentas.push(totales as unknown as (typeof sheetVentas)[number])

    // === SHEET 2: ITEMS ===
    const sheetItems: Array<Record<string, string | number>> = []
    for (const v of ventas) {
      for (const i of v.items) {
        const variante = formatAtributos(i.variante_atributos) || '—'
        sheetItems.push({
          'N° venta': v.numero,
          Fecha: formatearFecha(v.created_at),
          Cliente: v.cliente_razon_social,
          Producto: i.producto_nombre,
          'SKU producto': i.producto_sku,
          Variante: variante,
          'SKU variante': i.variante_sku,
          Cantidad: i.cantidad,
          'Precio unit. neto': round2(i.precio_unitario_neto),
          'Subtotal neto': round2(i.subtotal_neto),
        })
      }
    }

    // === WORKBOOK ===
    const workbook = XLSX.utils.book_new()

    const wsVentas = XLSX.utils.json_to_sheet(sheetVentas)
    XLSX.utils.book_append_sheet(workbook, wsVentas, 'Ventas')
    aplicarAnchosColumnas(wsVentas, [
      6, 12, 8, 25, 30, 7, 14, 12, 14, 14, 14, 25, 14, 14, 16, 16, 16, 12, 12,
      30,
    ])

    const wsItems = XLSX.utils.json_to_sheet(sheetItems)
    XLSX.utils.book_append_sheet(workbook, wsItems, 'Items')
    aplicarAnchosColumnas(wsItems, [8, 12, 30, 30, 14, 18, 18, 10, 16, 14])

    // === GENERAR BUFFER ===
    const buffer: Buffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
    })
    const dataBase64 = buffer.toString('base64')

    const filename = `ventas_${new Date().toISOString().slice(0, 10)}_${ventas.length}items.xlsx`

    return { ok: true, filename, dataBase64 }
  } catch (err) {
    console.error('[exportarVentasExcel] Error:', err)
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return { ok: false, error: msg }
  }
}

// ============ Helpers ============

function aplicarAnchosColumnas(ws: XLSX.WorkSheet, anchos: number[]): void {
  ws['!cols'] = anchos.map((w) => ({ wch: w }))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatearFecha(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getDate()).padStart(2, '0')
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const yr = d.getFullYear()
  return `${day}/${mon}/${yr}`
}

function formatearHora(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function labelFactura(tipo: string): string {
  switch (tipo) {
    case 'sin_factura':
      return 'Sin factura'
    case 'factura_a':
      return 'Factura A'
    case 'factura_b':
      return 'Factura B'
    case 'factura_c':
      // Backcompat literal — el dueño del Excel puede querer ver el
      // valor original en filas viejas de homologacion.
      return 'Factura C'
    default:
      return tipo
  }
}

function labelEstado(estado: string): string {
  switch (estado) {
    case 'cerrada':
      return 'Cerrada'
    case 'anulada':
      return 'Anulada'
    case 'abierta':
      return 'Abierta'
    case 'guardada':
      return 'Guardada'
    default:
      return estado
  }
}