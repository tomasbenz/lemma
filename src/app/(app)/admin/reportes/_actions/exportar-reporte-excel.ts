'use server'

import * as XLSX from 'xlsx'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import {
  obtenerKpis,
  obtenerVentasPorDia,
  obtenerTopProductos,
  obtenerDistribucionMediosPago,
  type PeriodoReporte,
} from '@/lib/queries/reportes'

const PERIODOS_VALIDOS: PeriodoReporte[] = [
  'hoy',
  'ayer',
  'semana_actual',
  'mes_actual',
  'mes_pasado',
  'anio_actual',
  'personalizado',
]

const PERIODOS_LABEL: Record<PeriodoReporte, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana_actual: 'Esta semana',
  mes_actual: 'Este mes',
  mes_pasado: 'Mes pasado',
  anio_actual: 'Este año',
  personalizado: 'Personalizado',
}

const LABELS_MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago_qr: 'Mercado Pago QR',
  otro: 'Otro',
}

type Resultado =
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string }

export async function exportarReporteExcel(
  periodoRaw: string
): Promise<Resultado> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }

    const periodo: PeriodoReporte = PERIODOS_VALIDOS.includes(
      periodoRaw as PeriodoReporte
    )
      ? (periodoRaw as PeriodoReporte)
      : 'mes_actual'

    const [config, kpis, ventasPorDia, topProductos, mediosPago] =
      await Promise.all([
        obtenerConfiguracion(),
        obtenerKpis(periodo),
        obtenerVentasPorDia(periodo),
        // Sin límite: queremos TODOS los productos vendidos en el Excel
        obtenerTopProductos(periodo, 1000),
        obtenerDistribucionMediosPago(periodo),
      ])

    const wb = XLSX.utils.book_new()

    // ============ HOJA 1: Resumen ============
    const resumenData = [
      ['REPORTE DE VENTAS'],
      [],
      ['Empresa', config.razon_social],
      ['CUIT', config.cuit],
      ['Período', PERIODOS_LABEL[periodo]],
      [
        'Generado',
        new Date().toLocaleString('es-AR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      ],
      [],
      ['Indicador', 'Valor'],
      ['Ventas realizadas', kpis.ventas_total],
      ['Total cobrado', kpis.ventas_total_cobrado],
      ['Unidades vendidas', kpis.unidades],
      ['Ticket promedio', kpis.ticket_promedio],
      ['Clientes únicos', kpis.clientes_unicos],
    ]
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData)
    wsResumen['!cols'] = [{ wch: 30 }, { wch: 22 }]
    // Formato moneda para los montos
    const montosResumen = ['B10', 'B12'] // facturación total y ticket promedio
    for (const ref of montosResumen) {
      if (wsResumen[ref]) {
        wsResumen[ref].z = '"$"#,##0.00'
      }
    }
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

    // ============ HOJA 2: Productos ============
    const productosHeader = [
      '#',
      'Producto',
      'SKU',
      'Unidades vendidas',
      'Monto facturado (con IVA)',
    ]
    const productosRows = topProductos.map((p, i) => [
      i + 1,
      p.producto_nombre,
      p.producto_sku,
      p.unidades,
      p.monto,
    ])
    const totalUnidades = topProductos.reduce((a, p) => a + p.unidades, 0)
    const totalMonto = topProductos.reduce((a, p) => a + p.monto, 0)
    productosRows.push(['', 'TOTAL', '', totalUnidades, totalMonto])

    const wsProductos = XLSX.utils.aoa_to_sheet([
      productosHeader,
      ...productosRows,
    ])
    wsProductos['!cols'] = [
      { wch: 5 },
      { wch: 40 },
      { wch: 22 },
      { wch: 18 },
      { wch: 22 },
    ]
    // Formato moneda en columna E
    const rangoProd = XLSX.utils.decode_range(wsProductos['!ref'] ?? 'A1')
    for (let r = 1; r <= rangoProd.e.r; r++) {
      const cell = wsProductos[XLSX.utils.encode_cell({ r, c: 4 })]
      if (cell && typeof cell.v === 'number') {
        cell.z = '"$"#,##0.00'
      }
    }
    XLSX.utils.book_append_sheet(wb, wsProductos, 'Productos')

    // ============ HOJA 3: Medios de pago ============
    const totalMedios = mediosPago.reduce((a, m) => a + m.monto, 0)
    const mediosHeader = [
      'Medio de pago',
      'Monto',
      'Porcentaje',
      'Transacciones',
    ]
    const mediosRows = mediosPago.map((m) => [
      LABELS_MEDIO[m.medio] ?? m.medio,
      m.monto,
      totalMedios > 0 ? m.monto / totalMedios : 0,
      m.cantidad_transacciones,
    ])
    const totalTx = mediosPago.reduce(
      (a, m) => a + m.cantidad_transacciones,
      0
    )
    mediosRows.push(['TOTAL', totalMedios, 1, totalTx])

    const wsMedios = XLSX.utils.aoa_to_sheet([mediosHeader, ...mediosRows])
    wsMedios['!cols'] = [
      { wch: 22 },
      { wch: 18 },
      { wch: 14 },
      { wch: 16 },
    ]
    const rangoMed = XLSX.utils.decode_range(wsMedios['!ref'] ?? 'A1')
    for (let r = 1; r <= rangoMed.e.r; r++) {
      const cMonto = wsMedios[XLSX.utils.encode_cell({ r, c: 1 })]
      if (cMonto && typeof cMonto.v === 'number') cMonto.z = '"$"#,##0.00'
      const cPct = wsMedios[XLSX.utils.encode_cell({ r, c: 2 })]
      if (cPct && typeof cPct.v === 'number') cPct.z = '0.0%'
    }
    XLSX.utils.book_append_sheet(wb, wsMedios, 'Medios de pago')

    // ============ HOJA 4: Ventas diarias ============
    const diariasHeader = [
      'Fecha',
      'Día',
      'Cantidad de ventas',
      'Monto facturado (con IVA)',
    ]
    const diariasRows = ventasPorDia.map((d) => {
      const fecha = new Date(d.fecha + 'T12:00:00')
      return [
        fecha, // como Date real para que Excel la trate como fecha
        fecha.toLocaleDateString('es-AR', { weekday: 'long' }),
        d.cantidad,
        d.monto,
      ]
    })
    const totalDiaCant = ventasPorDia.reduce((a, d) => a + d.cantidad, 0)
    const totalDiaMonto = ventasPorDia.reduce((a, d) => a + d.monto, 0)
    diariasRows.push(['', 'TOTAL', totalDiaCant, totalDiaMonto])

    const wsDiarias = XLSX.utils.aoa_to_sheet([diariasHeader, ...diariasRows])
    wsDiarias['!cols'] = [
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 22 },
    ]
    const rangoDia = XLSX.utils.decode_range(wsDiarias['!ref'] ?? 'A1')
    for (let r = 1; r <= rangoDia.e.r; r++) {
      const cFecha = wsDiarias[XLSX.utils.encode_cell({ r, c: 0 })]
      if (cFecha && cFecha.v instanceof Date) cFecha.z = 'dd/mm/yyyy'
      const cMonto = wsDiarias[XLSX.utils.encode_cell({ r, c: 3 })]
      if (cMonto && typeof cMonto.v === 'number') cMonto.z = '"$"#,##0.00'
    }
    XLSX.utils.book_append_sheet(wb, wsDiarias, 'Ventas diarias')

    // ============ Generar buffer y devolver base64 ============
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const base64 = buffer.toString('base64')

    const filename = `reporte-${periodo}-${
      new Date().toISOString().split('T')[0]
    }.xlsx`

    return { ok: true, base64, filename }
  } catch (err) {
    console.error('[exportarReporteExcel]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}