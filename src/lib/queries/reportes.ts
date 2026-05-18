import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PeriodoReporte = '7d' | '30d' | '90d' | 'mes_actual' | 'anio_actual'

export type KpisReporte = {
  ventas_total: number
  /** Suma de venta.total: lo que efectivamente cobró el negocio
   *  (precios netos + recargo 10,5% opcional). NO se le suma 21% encima. */
  ventas_total_cobrado: number
  unidades: number
  ticket_promedio: number
  clientes_unicos: number
}

export type VentaPorDia = {
  fecha: string // YYYY-MM-DD
  monto: number
  cantidad: number
}

export type ProductoTop = {
  producto_nombre: string
  producto_sku: string
  unidades: number
  monto: number
}

export type MedioPagoAgregado = {
  medio: string
  monto: number
  cantidad_transacciones: number
}

// ============ Helper: rango de fechas ============

function calcularRango(periodo: PeriodoReporte): { desde: Date; hasta: Date } {
  const hasta = new Date()
  const desde = new Date()

  switch (periodo) {
    case '7d':
      desde.setDate(hasta.getDate() - 7)
      break
    case '30d':
      desde.setDate(hasta.getDate() - 30)
      break
    case '90d':
      desde.setDate(hasta.getDate() - 90)
      break
    case 'mes_actual':
      desde.setDate(1)
      desde.setHours(0, 0, 0, 0)
      break
    case 'anio_actual':
      desde.setMonth(0, 1)
      desde.setHours(0, 0, 0, 0)
      break
  }

  return { desde, hasta }
}

// ============ Query agregada en DB (KPIs + ventas por día) ============

// Forma cruda devuelta por la función SQL `reporte_ventas_agregado`.
// Los campos `*_neto` son nombres SQL legacy (cuando se sumaba 21% en el
// cliente); bajo el modelo nuevo el monto YA es lo cobrado real.
type RespuestaAgregada = {
  kpis: {
    ventas_total: number
    ventas_monto_neto: number
    unidades: number
    clientes_unicos: number
  }
  por_dia: Array<{
    fecha: string
    monto_neto: number
    cantidad: number
  }>
}

/**
 * Obtiene KPIs y ventas por día en una sola llamada a la DB.
 * Usa la función SQL reporte_ventas_agregado.
 */
export async function obtenerKpisYVentasDiarias(
  periodo: PeriodoReporte
): Promise<{ kpis: KpisReporte; ventasPorDia: VentaPorDia[] }> {
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(periodo)

  const { data, error } = await supabase.rpc('reporte_ventas_agregado', {
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  } as never)

  if (error || !data) {
    console.error('[obtenerKpisYVentasDiarias]', error)
    return {
      kpis: {
        ventas_total: 0,
        ventas_total_cobrado: 0,
        unidades: 0,
        ticket_promedio: 0,
        clientes_unicos: 0,
      },
      ventasPorDia: [],
    }
  }

  const r = data as unknown as RespuestaAgregada

  const ventasTotal = r.kpis.ventas_total ?? 0
  const totalCobrado = r.kpis.ventas_monto_neto ?? 0
  const kpis: KpisReporte = {
    ventas_total: ventasTotal,
    ventas_total_cobrado: totalCobrado,
    unidades: r.kpis.unidades ?? 0,
    ticket_promedio: ventasTotal > 0 ? totalCobrado / ventasTotal : 0,
    clientes_unicos: r.kpis.clientes_unicos ?? 0,
  }

  // Ventas por día: rellenar huecos con 0
  const mapa = new Map<string, { monto: number; cantidad: number }>()
  for (const d of r.por_dia ?? []) {
    mapa.set(d.fecha, {
      monto: d.monto_neto,
      cantidad: d.cantidad,
    })
  }

  const ventasPorDia: VentaPorDia[] = []
  const cursor = new Date(desde)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= hasta) {
    const key = cursor.toISOString().split('T')[0]
    const entry = mapa.get(key) ?? { monto: 0, cantidad: 0 }
    ventasPorDia.push({
      fecha: key,
      monto: entry.monto,
      cantidad: entry.cantidad,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return { kpis, ventasPorDia }
}

// ============ Top productos ============

export async function obtenerTopProductos(
  periodo: PeriodoReporte,
  limit: number = 10
): Promise<ProductoTop[]> {
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(periodo)

  const { data, error } = await supabase
    .from('items_venta')
    .select(
      `
      producto_nombre,
      producto_sku,
      cantidad,
      subtotal_neto,
      venta:ventas!inner(estado, created_at)
    `
    )
    .gte('venta.created_at', desde.toISOString())
    .lte('venta.created_at', hasta.toISOString())
    .eq('venta.estado', 'cerrada')

  if (error || !data) {
    console.error('[obtenerTopProductos]', error)
    return []
  }

  const mapa = new Map<
    string,
    { nombre: string; unidades: number; monto: number }
  >()

  for (const i of data) {
    const key = i.producto_sku
    const actual = mapa.get(key) ?? {
      nombre: i.producto_nombre,
      unidades: 0,
      monto: 0,
    }
    actual.unidades += i.cantidad
    actual.monto += i.subtotal_neto
    mapa.set(key, actual)
  }

  return Array.from(mapa.entries())
    .map(([sku, v]) => ({
      producto_nombre: v.nombre,
      producto_sku: sku,
      unidades: v.unidades,
      monto: v.monto,
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limit)
}

// ============ Medios de pago ============

export async function obtenerDistribucionMediosPago(
  periodo: PeriodoReporte
): Promise<MedioPagoAgregado[]> {
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(periodo)

  const { data, error } = await supabase
    .from('medios_pago_venta')
    .select(
      `
      medio,
      monto,
      venta:ventas!inner(estado, created_at)
    `
    )
    .gte('venta.created_at', desde.toISOString())
    .lte('venta.created_at', hasta.toISOString())
    .eq('venta.estado', 'cerrada')

  if (error || !data) {
    console.error('[obtenerDistribucionMediosPago]', error)
    return []
  }

  const mapa = new Map<string, { monto: number; cantidad: number }>()

  for (const m of data) {
    const actual = mapa.get(m.medio) ?? { monto: 0, cantidad: 0 }
    actual.monto += m.monto
    actual.cantidad += 1
    mapa.set(m.medio, actual)
  }

  return Array.from(mapa.entries())
    .map(([medio, v]) => ({
      medio,
      monto: v.monto,
      cantidad_transacciones: v.cantidad,
    }))
    .sort((a, b) => b.monto - a.monto)
}

// ============ Wrappers por compatibilidad ============
// Los page.tsx viejos podrían seguir llamando a estos nombres
// Mantenerlos para no romper imports existentes.

export async function obtenerKpis(periodo: PeriodoReporte): Promise<KpisReporte> {
  const { kpis } = await obtenerKpisYVentasDiarias(periodo)
  return kpis
}

export async function obtenerVentasPorDia(
  periodo: PeriodoReporte
): Promise<VentaPorDia[]> {
  const { ventasPorDia } = await obtenerKpisYVentasDiarias(periodo)
  return ventasPorDia
}