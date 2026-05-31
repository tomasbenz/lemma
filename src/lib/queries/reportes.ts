import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { calcularRango } from './reportes-rango'

// Re-export del cálculo de rango (módulo puro, testeable sin server-only).
export { calcularRango } from './reportes-rango'
export type { PeriodoReporte, OpcionesReporte } from './reportes-rango'
import type { PeriodoReporte, OpcionesReporte } from './reportes-rango'

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

export type VentasAnuladasAgregado = {
  cantidad: number
  monto_total: number
}

// ============ Query agregada en DB (KPIs + ventas por día) ============

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

const KPIS_VACIOS: KpisReporte = {
  ventas_total: 0,
  ventas_total_cobrado: 0,
  unidades: 0,
  ticket_promedio: 0,
  clientes_unicos: 0,
}

/**
 * Obtiene KPIs y ventas por día.
 *
 * Si `opts.turnoId` viene, hace una query TS directa filtrando por
 * `turno_id` (la RPC `reporte_ventas_agregado` no acepta ese filtro).
 * Si no, usa la RPC agregada.
 */
export async function obtenerKpisYVentasDiarias(
  arg: PeriodoOrOpts
): Promise<{ kpis: KpisReporte; ventasPorDia: VentaPorDia[] }> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  if (opts.turnoId) {
    // Query TS directa: ventas cerradas del turno + rango.
    const { data, error } = await supabase
      .from('ventas')
      .select(
        `
        id,
        total,
        created_at,
        cliente_id,
        items_venta(cantidad)
      `
      )
      .eq('estado', 'cerrada')
      .eq('turno_id', opts.turnoId)
      .gte('created_at', desde.toISOString())
      .lte('created_at', hasta.toISOString())

    if (error || !data) {
      console.error('[obtenerKpisYVentasDiarias][turno]', error)
      return { kpis: { ...KPIS_VACIOS }, ventasPorDia: [] }
    }

    let unidades = 0
    let totalCobrado = 0
    const porDia = new Map<string, { monto: number; cantidad: number }>()
    const clientes = new Set<string>()

    for (const v of data) {
      totalCobrado += v.total ?? 0
      const items = (v.items_venta ?? []) as Array<{ cantidad: number }>
      for (const i of items) unidades += i.cantidad ?? 0
      if (v.cliente_id) clientes.add(v.cliente_id)
      const fecha = (v.created_at as string).slice(0, 10)
      const entry = porDia.get(fecha) ?? { monto: 0, cantidad: 0 }
      entry.monto += v.total ?? 0
      entry.cantidad += 1
      porDia.set(fecha, entry)
    }

    const ventasTotal = data.length
    const kpis: KpisReporte = {
      ventas_total: ventasTotal,
      ventas_total_cobrado: totalCobrado,
      unidades,
      ticket_promedio: ventasTotal > 0 ? totalCobrado / ventasTotal : 0,
      clientes_unicos: clientes.size,
    }
    const ventasPorDia = rellenarHuecos(porDia, desde, hasta)
    return { kpis, ventasPorDia }
  }

  // Sin filtro de turno: usar RPC agregada (más eficiente).
  const { data, error } = await supabase.rpc('reporte_ventas_agregado', {
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
  } as never)

  if (error || !data) {
    console.error('[obtenerKpisYVentasDiarias]', error)
    return { kpis: { ...KPIS_VACIOS }, ventasPorDia: [] }
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

  const mapa = new Map<string, { monto: number; cantidad: number }>()
  for (const d of r.por_dia ?? []) {
    mapa.set(d.fecha, { monto: d.monto_neto, cantidad: d.cantidad })
  }

  const ventasPorDia = rellenarHuecos(mapa, desde, hasta)
  return { kpis, ventasPorDia }
}

function rellenarHuecos(
  mapa: Map<string, { monto: number; cantidad: number }>,
  desde: Date,
  hasta: Date
): VentaPorDia[] {
  const out: VentaPorDia[] = []
  const cursor = new Date(desde)
  cursor.setHours(0, 0, 0, 0)
  const limite = new Date(hasta)
  limite.setHours(0, 0, 0, 0)
  while (cursor <= limite) {
    const key = cursor.toISOString().split('T')[0]
    const entry = mapa.get(key) ?? { monto: 0, cantidad: 0 }
    out.push({ fecha: key, monto: entry.monto, cantidad: entry.cantidad })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// ============ Top productos ============

export async function obtenerTopProductos(
  arg: PeriodoOrOpts,
  limit: number = 10
): Promise<ProductoTop[]> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  let query = supabase
    .from('items_venta')
    .select(
      `
      producto_nombre,
      producto_sku,
      cantidad,
      subtotal_neto,
      venta:ventas!inner(estado, created_at, turno_id)
    `
    )
    .gte('venta.created_at', desde.toISOString())
    .lte('venta.created_at', hasta.toISOString())
    .eq('venta.estado', 'cerrada')

  if (opts.turnoId) {
    query = query.eq('venta.turno_id', opts.turnoId)
  }

  const { data, error } = await query

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
  arg: PeriodoOrOpts
): Promise<MedioPagoAgregado[]> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  let query = supabase
    .from('medios_pago_venta')
    .select(
      `
      medio,
      monto,
      venta:ventas!inner(estado, created_at, turno_id)
    `
    )
    .gte('venta.created_at', desde.toISOString())
    .lte('venta.created_at', hasta.toISOString())
    .eq('venta.estado', 'cerrada')

  if (opts.turnoId) {
    query = query.eq('venta.turno_id', opts.turnoId)
  }

  const { data, error } = await query

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

// ============ Ventas anuladas (trazabilidad) ============
//
// Devuelve cuántas ventas se anularon en el período (y el monto que
// hubieran cobrado). Útil para auditar "cuánto se anuló". No filtramos
// estas ventas en otros KPIs — esos solo cuentan 'cerrada'.

export async function obtenerVentasAnuladas(
  arg: PeriodoOrOpts
): Promise<VentasAnuladasAgregado> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  let query = supabase
    .from('ventas')
    .select('total, turno_id, estado, created_at')
    .eq('estado', 'anulada')
    .gte('created_at', desde.toISOString())
    .lte('created_at', hasta.toISOString())

  if (opts.turnoId) {
    query = query.eq('turno_id', opts.turnoId)
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('[obtenerVentasAnuladas]', error)
    return { cantidad: 0, monto_total: 0 }
  }

  let monto = 0
  for (const v of data) {
    monto += v.total ?? 0
  }

  return { cantidad: data.length, monto_total: monto }
}

// ============ Wrappers retrocompatibles ============
//
// Las funciones públicas antes recibían PeriodoReporte directo.
// Ahora aceptan OpcionesReporte. Mantenemos los nombres viejos con
// una sobrecarga que admite ambos para no romper imports en route
// handlers/excel/etc.

type PeriodoOrOpts = PeriodoReporte | OpcionesReporte

function asOpts(arg: PeriodoOrOpts): OpcionesReporte {
  if (typeof arg === 'string') return { periodo: arg }
  return arg
}

export async function obtenerKpis(arg: PeriodoOrOpts): Promise<KpisReporte> {
  const { kpis } = await obtenerKpisYVentasDiarias(asOpts(arg))
  return kpis
}

export async function obtenerVentasPorDia(
  arg: PeriodoOrOpts
): Promise<VentaPorDia[]> {
  const { ventasPorDia } = await obtenerKpisYVentasDiarias(asOpts(arg))
  return ventasPorDia
}

// ============================================================================
// Dashboard expandido (Fase 2) — RPC consolidada reporte_dashboard
// ============================================================================

export type GananciaReporte = {
  monto: number
  items_con_costo: number
  items_total: number
  cobertura_pct: number
}

export type ProductoMonto = {
  producto_id: string
  producto_nombre: string
  producto_sku: string
  monto: number
  unidades: number
}

export type ProductoMargen = {
  producto_id: string
  producto_nombre: string
  producto_sku: string
  margen: number
  monto: number
  unidades: number
}

export type ProductoDormido = {
  producto_id: string
  producto_nombre: string
  producto_sku: string
  stock_total: number | null
}

export type MarcaRanking = {
  marca_id: string | null
  marca_nombre: string
  monto: number
  unidades: number
}

export type VentaPorHora = {
  hora: number
  transacciones: number
  monto: number
}

export type VendedorReporte = {
  usuario_id: string
  nombre_completo: string
  transacciones: number
  monto: number
}

export type ReporteDashboard = {
  ganancia: GananciaReporte
  top_monto: ProductoMonto[]
  top_cantidad: ProductoMonto[]
  margen_negativo: ProductoMargen[]
  dormidos: ProductoDormido[]
  ranking_marcas: MarcaRanking[]
  ventas_por_hora: VentaPorHora[]
  ventas_por_vendedor: VendedorReporte[]
}

const DASHBOARD_VACIO: ReporteDashboard = {
  ganancia: { monto: 0, items_con_costo: 0, items_total: 0, cobertura_pct: 0 },
  top_monto: [],
  top_cantidad: [],
  margen_negativo: [],
  dormidos: [],
  ranking_marcas: [],
  ventas_por_hora: [],
  ventas_por_vendedor: [],
}

/**
 * Llama a la RPC consolidada `reporte_dashboard` (todas las secciones nuevas en
 * una sola roundtrip). SECURITY INVOKER + RLS limitan por empresa del caller.
 */
export async function obtenerReporteDashboard(
  arg: PeriodoOrOpts
): Promise<ReporteDashboard> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  const { data, error } = await supabase.rpc('reporte_dashboard', {
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
    p_turno_id: opts.turnoId ?? undefined,
  })

  if (error || !data) {
    console.error('[obtenerReporteDashboard]', error)
    return { ...DASHBOARD_VACIO }
  }

  const r = data as unknown as Partial<ReporteDashboard>
  return {
    ganancia: r.ganancia ?? DASHBOARD_VACIO.ganancia,
    top_monto: r.top_monto ?? [],
    top_cantidad: r.top_cantidad ?? [],
    margen_negativo: r.margen_negativo ?? [],
    dormidos: r.dormidos ?? [],
    ranking_marcas: r.ranking_marcas ?? [],
    ventas_por_hora: r.ventas_por_hora ?? [],
    ventas_por_vendedor: r.ventas_por_vendedor ?? [],
  }
}

// ============================================================================
// Turnos con diferencia de caja (query directa, sin RPC)
// ============================================================================

export type TurnoDiferencia = {
  id: string
  abierto_at: string
  cerrado_at: string | null
  vendedor: string | null
  base_inicial: number
  total_declarado: number | null
  diferencia: number
}

type UsuarioEmbed = { nombre_completo: string | null; email: string | null }

/**
 * Turnos cerrados en el rango con diferencia de caja distinta de cero.
 * El rango se calcula por `cerrado_at` (cuándo se cerró el turno).
 */
export async function obtenerTurnosConDiferencia(
  arg: PeriodoOrOpts
): Promise<TurnoDiferencia[]> {
  const opts = asOpts(arg)
  const supabase = await createClient()
  const { desde, hasta } = calcularRango(opts)

  let query = supabase
    .from('turnos_caja')
    .select(
      `
      id,
      abierto_at,
      cerrado_at,
      base_inicial,
      total_declarado,
      diferencia,
      usuario_apertura:usuarios!turnos_caja_usuario_apertura_id_fkey(nombre_completo, email)
    `
    )
    .not('cerrado_at', 'is', null)
    .not('diferencia', 'is', null)
    .neq('diferencia', 0)
    .gte('cerrado_at', desde.toISOString())
    .lte('cerrado_at', hasta.toISOString())
    .order('cerrado_at', { ascending: false })

  if (opts.turnoId) {
    query = query.eq('id', opts.turnoId)
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('[obtenerTurnosConDiferencia]', error)
    return []
  }

  return data.map((t) => {
    const uaRaw = t.usuario_apertura as
      | UsuarioEmbed
      | UsuarioEmbed[]
      | null
    const ua = Array.isArray(uaRaw) ? uaRaw[0] ?? null : uaRaw
    return {
      id: t.id as string,
      abierto_at: t.abierto_at as string,
      cerrado_at: t.cerrado_at as string | null,
      vendedor: ua?.nombre_completo ?? ua?.email ?? null,
      base_inicial: Number(t.base_inicial ?? 0),
      total_declarado:
        t.total_declarado !== null ? Number(t.total_declarado) : null,
      diferencia: Number(t.diferencia ?? 0),
    }
  })
}
