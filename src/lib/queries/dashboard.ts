// src/lib/queries/dashboard.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PedidoBandeja = {
  id: string
  numero: number
  created_at: string
  vista_at: string | null
  subtotal_neto: number
  items_count: number
  vendedor_nombre: string
  cliente_nombre: string | null
}

export type DashboardStats = {
  // Pedidos pendientes con bandeja nuevos/vistos
  pedidosNuevos: PedidoBandeja[]
  pedidosVistos: PedidoBandeja[]
  // Resumen de hoy
  ventasHoy: number
  montoHoy: number
  ventasAyer: number
  montoAyer: number
  // Resumen del mes
  ventasMes: number
  montoMes: number
  ventasMesAnterior: number
  montoMesAnterior: number
  // Stock crítico
  productosStockBajo: number
  productosSinStock: number
}

type UsuarioRaw = {
  nombre_completo: string | null
  email: string
}
type ClienteRaw = { razon_social: string }

function inicioDia(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function inicioMes(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1)
  return r
}

export async function obtenerDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const ahora = new Date()

  const hoyInicio = inicioDia(ahora)
  const ayerInicio = new Date(hoyInicio)
  ayerInicio.setDate(ayerInicio.getDate() - 1)

  const mesInicio = inicioMes(ahora)
  const mesAnteriorInicio = new Date(
    mesInicio.getFullYear(),
    mesInicio.getMonth() - 1,
    1
  )

  // ============ Pedidos pendientes (con bandeja) ============
  const { data: pedidosRaw } = await supabase
    .from('ventas')
    .select(
      `
      id,
      numero,
      created_at,
      vista_at,
      subtotal_neto,
      items_count:items_venta(count),
      usuario:usuarios!ventas_usuario_id_fkey(nombre_completo, email),
      cliente:clientes(razon_social)
    `
    )
    .eq('estado', 'guardada')
    .order('created_at', { ascending: false })

  const pedidos: PedidoBandeja[] = (pedidosRaw ?? []).map((p) => {
    const countRaw = p.items_count as unknown as
      | Array<{ count: number }>
      | number
      | null
    let itemsCount = 0
    if (Array.isArray(countRaw) && countRaw.length > 0) {
      itemsCount = countRaw[0].count ?? 0
    } else if (typeof countRaw === 'number') {
      itemsCount = countRaw
    }

    const u = Array.isArray(p.usuario)
      ? p.usuario[0]
      : (p.usuario as UsuarioRaw | null)
    const c = Array.isArray(p.cliente)
      ? p.cliente[0]
      : (p.cliente as ClienteRaw | null)

    return {
      id: p.id,
      numero: p.numero,
      created_at: p.created_at,
      vista_at: p.vista_at,
      subtotal_neto: p.subtotal_neto,
      items_count: itemsCount,
      vendedor_nombre: u?.nombre_completo ?? u?.email ?? '—',
      cliente_nombre: c?.razon_social ?? null,
    }
  })

  const pedidosNuevos = pedidos.filter((p) => p.vista_at === null)
  const pedidosVistos = pedidos.filter((p) => p.vista_at !== null)

  // ============ Ventas hoy / ayer ============
  const { data: hoyData } = await supabase
    .from('ventas')
    .select('total')
    .eq('estado', 'cerrada')
    .gte('closed_at', hoyInicio.toISOString())

  const ventasHoy = hoyData?.length ?? 0
  const montoHoy = (hoyData ?? []).reduce(
    (acc, v) => acc + Number(v.total ?? 0),
    0
  )

  const { data: ayerData } = await supabase
    .from('ventas')
    .select('total')
    .eq('estado', 'cerrada')
    .gte('closed_at', ayerInicio.toISOString())
    .lt('closed_at', hoyInicio.toISOString())

  const ventasAyer = ayerData?.length ?? 0
  const montoAyer = (ayerData ?? []).reduce(
    (acc, v) => acc + Number(v.total ?? 0),
    0
  )

  // ============ Ventas mes actual / mes anterior ============
  const { data: mesData } = await supabase
    .from('ventas')
    .select('total')
    .eq('estado', 'cerrada')
    .gte('closed_at', mesInicio.toISOString())

  const ventasMes = mesData?.length ?? 0
  const montoMes = (mesData ?? []).reduce(
    (acc, v) => acc + Number(v.total ?? 0),
    0
  )

  const { data: mesAntData } = await supabase
    .from('ventas')
    .select('total')
    .eq('estado', 'cerrada')
    .gte('closed_at', mesAnteriorInicio.toISOString())
    .lt('closed_at', mesInicio.toISOString())

  const ventasMesAnterior = mesAntData?.length ?? 0
  const montoMesAnterior = (mesAntData ?? []).reduce(
    (acc, v) => acc + Number(v.total ?? 0),
    0
  )

  // ============ Stock crítico ============
  const { data: variantes } = await supabase
    .from('variantes')
    .select('stock, producto:productos!inner(track_stock, activo)')
    .eq('activa', true)

  let sinStock = 0
  let stockBajo = 0
  for (const v of variantes ?? []) {
    type ProdRaw = { track_stock: boolean; activo: boolean }
    const prod = (Array.isArray(v.producto) ? v.producto[0] : v.producto) as
      | ProdRaw
      | undefined
    if (!prod?.activo || !prod.track_stock) continue
    if (v.stock === 0) sinStock += 1
    else if (v.stock > 0 && v.stock <= 5) stockBajo += 1
  }

  return {
    pedidosNuevos,
    pedidosVistos,
    ventasHoy,
    montoHoy,
    ventasAyer,
    montoAyer,
    ventasMes,
    montoMes,
    ventasMesAnterior,
    montoMesAnterior,
    productosStockBajo: stockBajo,
    productosSinStock: sinStock,
  }
}