// src/lib/queries/pedidos.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PedidoRow = {
  id: string
  numero: number
  estado: string
  created_at: string
  closed_at: string | null
  vista_at: string | null
  canal: string
  subtotal_neto: number
  total: number
  nota_interna: string | null
  nombre_cliente_custom: string | null
  items_count: number
  vendedor: {
    id: string
    nombre_completo: string | null
    email: string
  } | null
  cliente: {
    id: string
    razon_social: string
    cuit: string | null
    cond_iva: string
  } | null
}

export type PedidoItem = {
  id: string
  variante_id: string
  producto_nombre: string
  producto_sku: string
  variante_sku: string
  variante_atributos: Record<string, string>
  cantidad: number
  precio_unitario_neto: number
  subtotal_neto: number
  stock_actual: number
  variante_activa: boolean
  track_stock: boolean
}

export type PedidoDetalle = {
  id: string
  numero: number
  estado: string
  created_at: string
  canal: string
  subtotal_neto: number
  nota_interna: string | null
  nombre_cliente_custom: string | null
  vendedor: PedidoRow['vendedor']
  cliente: PedidoRow['cliente']
  items: PedidoItem[]
}

export type FiltrosPedidos = {
  vendedorId?: string | null
  clienteId?: string | null
  desde?: string | null
  hasta?: string | null
  busqueda?: string
  alcance?: 'pendientes' | 'pendientes_y_recientes' | 'todos'
  /**
   * Si esta seteado, restringe el listado a pedidos cuyo usuario_id
   * matchea. Defense in depth: la vendedora solo ve sus propios pedidos
   * (RLS + filtro explicito).
   */
  restringirUsuarioId?: string | null
}

type UsuarioRaw = {
  id: string
  nombre_completo: string | null
  email: string
}

type ClienteRaw = {
  id: string
  razon_social: string
  cuit: string | null
  cond_iva: string
}

function normalizarUsuario(
  raw: UsuarioRaw | UsuarioRaw[] | null
): PedidoRow['vendedor'] {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

function normalizarCliente(
  raw: ClienteRaw | ClienteRaw[] | null
): PedidoRow['cliente'] {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

export async function listarPedidos(
  filtros: FiltrosPedidos = {}
): Promise<PedidoRow[]> {
  const supabase = await createClient()
  const alcance = filtros.alcance ?? 'pendientes'

  let query = supabase
    .from('ventas')
    .select(
      `
      id,
      numero,
      estado,
      created_at,
      closed_at,
      vista_at,
      canal,
      subtotal_neto,
      total,
      nota_interna,
      nombre_cliente_custom,
      items_count:items_venta(count),
      usuario:usuarios!ventas_usuario_id_fkey(id, nombre_completo, email),
      cliente:clientes(id, razon_social, cuit, cond_iva)
    `
    )
    .order('created_at', { ascending: false })

  if (alcance === 'pendientes') {
    query = query.eq('estado', 'guardada')
  } else if (alcance === 'pendientes_y_recientes') {
    const hace7dias = new Date()
    hace7dias.setDate(hace7dias.getDate() - 7)
    const iso7d = hace7dias.toISOString()
    query = query.or(
      `estado.eq.guardada,and(estado.in.(cerrada,anulada),created_at.gte.${iso7d})`
    )
  }

  if (filtros.vendedorId) {
    query = query.eq('usuario_id', filtros.vendedorId)
  }
  if (filtros.restringirUsuarioId) {
    query = query.eq('usuario_id', filtros.restringirUsuarioId)
  }
  if (filtros.clienteId) {
    query = query.eq('cliente_id', filtros.clienteId)
  }
  if (filtros.desde) {
    query = query.gte('created_at', filtros.desde)
  }
  if (filtros.hasta) {
    query = query.lte('created_at', filtros.hasta)
  }

  const { data, error } = await query

  if (error) {
    console.error('[listarPedidos] Error:', error)
    return []
  }

  const rows = (data ?? []).map((r) => {
    const countRaw = r.items_count as unknown as
      | Array<{ count: number }>
      | number
      | null
    let itemsCount = 0
    if (Array.isArray(countRaw) && countRaw.length > 0) {
      itemsCount = countRaw[0].count ?? 0
    } else if (typeof countRaw === 'number') {
      itemsCount = countRaw
    }

    return {
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      created_at: r.created_at,
      closed_at: r.closed_at,
      vista_at: r.vista_at,
      canal: r.canal,
      subtotal_neto: r.subtotal_neto,
      total: r.total,
      nota_interna: r.nota_interna,
      nombre_cliente_custom:
        (r.nombre_cliente_custom as string | null) ?? null,
      items_count: itemsCount,
      vendedor: normalizarUsuario(
        r.usuario as UsuarioRaw | UsuarioRaw[] | null
      ),
      cliente: normalizarCliente(
        r.cliente as ClienteRaw | ClienteRaw[] | null
      ),
    } as PedidoRow
  })

  if (filtros.busqueda) {
    const q = filtros.busqueda.trim().toLowerCase().replace(/^#/, '')
    return rows.filter((r) => {
      return (
        String(r.numero).includes(q) ||
        r.vendedor?.nombre_completo?.toLowerCase().includes(q) ||
        r.vendedor?.email.toLowerCase().includes(q) ||
        r.cliente?.razon_social.toLowerCase().includes(q) ||
        r.cliente?.cuit?.toLowerCase().includes(q) ||
        r.nombre_cliente_custom?.toLowerCase().includes(q)
      )
    })
  }

  return rows
}

export async function contarPedidosPendientes(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('ventas')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'guardada')

  if (error) {
    console.error('[contarPedidosPendientes] Error:', error)
    return 0
  }

  return count ?? 0
}

export async function listarVendedoresConPedidos(): Promise<
  Array<{ id: string; nombre_completo: string | null; email: string }>
> {
  const supabase = await createClient()

  // Trae rol en el join para poder filtrar superadmins del listado de
  // "vendedoras de la empresa" (no son usuarios del cliente).
  const { data, error } = await supabase
    .from('ventas')
    .select(
      'usuario:usuarios!ventas_usuario_id_fkey(id, nombre_completo, email, rol)'
    )
    .eq('estado', 'guardada')

  if (error || !data) {
    return []
  }

  const map = new Map<
    string,
    { id: string; nombre_completo: string | null; email: string }
  >()
  for (const row of data) {
    const raw = row.usuario as
      | (UsuarioRaw & { rol?: string })
      | (UsuarioRaw & { rol?: string })[]
      | null
    const flat = Array.isArray(raw) ? raw[0] : raw
    if (flat?.rol === 'superadmin') continue
    const u = normalizarUsuario(raw as UsuarioRaw | UsuarioRaw[] | null)
    if (u) map.set(u.id, u)
  }

  return Array.from(map.values()).sort((a, b) => {
    const na = a.nombre_completo ?? a.email
    const nb = b.nombre_completo ?? b.email
    return na.localeCompare(nb)
  })
}

/**
 * Obtiene un pedido completo (solo si está en estado guardada).
 * Incluye stock actual de cada variante para validar al finalizar.
 *
 * Si `opts.restringirUsuarioId` esta seteado, devuelve null cuando el
 * pedido no pertenece a ese usuario. Defense in depth para vendedora
 * (que solo puede ver/gestionar pedidos propios).
 */
export async function obtenerPedido(
  id: string,
  opts: { restringirUsuarioId?: string | null } = {}
): Promise<PedidoDetalle | null> {
  const supabase = await createClient()

  let query = supabase
    .from('ventas')
    .select(
      `
      id,
      numero,
      estado,
      created_at,
      canal,
      subtotal_neto,
      nota_interna,
      nombre_cliente_custom,
      usuario:usuarios!ventas_usuario_id_fkey(id, nombre_completo, email),
      cliente:clientes(id, razon_social, cuit, cond_iva),
      items_venta(
        id,
        variante_id,
        producto_nombre,
        producto_sku,
        variante_sku,
        variante_atributos,
        cantidad,
        precio_unitario_neto,
        subtotal_neto,
        variante:variantes(
          stock,
          activa,
          producto:productos(track_stock)
        )
      )
    `
    )
    .eq('id', id)
    .eq('estado', 'guardada')

  if (opts.restringirUsuarioId) {
    query = query.eq('usuario_id', opts.restringirUsuarioId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error('[obtenerPedido] Error:', error)
    return null
  }

  if (!data) return null

  type VarianteRaw = {
    stock: number
    activa: boolean
    producto: { track_stock: boolean } | { track_stock: boolean }[] | null
  }

  type ItemRaw = {
    id: string
    variante_id: string
    producto_nombre: string
    producto_sku: string
    variante_sku: string
    variante_atributos: unknown
    cantidad: number
    precio_unitario_neto: number
    subtotal_neto: number
    variante: VarianteRaw | VarianteRaw[] | null
  }

  function coerceAtributos(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v !== null && v !== undefined) out[k] = String(v)
    }
    return out
  }

  const itemsRaw = (data.items_venta ?? []) as ItemRaw[]

  const items: PedidoItem[] = itemsRaw.map((i) => {
    const varianteRaw = Array.isArray(i.variante) ? i.variante[0] : i.variante
    const productoRaw = varianteRaw
      ? Array.isArray(varianteRaw.producto)
        ? varianteRaw.producto[0]
        : varianteRaw.producto
      : null

    return {
      id: i.id,
      variante_id: i.variante_id,
      producto_nombre: i.producto_nombre,
      producto_sku: i.producto_sku,
      variante_sku: i.variante_sku,
      variante_atributos: coerceAtributos(i.variante_atributos),
      cantidad: i.cantidad,
      precio_unitario_neto: i.precio_unitario_neto,
      subtotal_neto: i.subtotal_neto,
      stock_actual: varianteRaw?.stock ?? 0,
      variante_activa: varianteRaw?.activa ?? false,
      track_stock: productoRaw?.track_stock ?? false,
    }
  })

  return {
    id: data.id,
    numero: data.numero,
    estado: data.estado,
    created_at: data.created_at,
    canal: data.canal,
    subtotal_neto: data.subtotal_neto,
    nota_interna: data.nota_interna,
    nombre_cliente_custom:
      (data.nombre_cliente_custom as string | null) ?? null,
    vendedor: normalizarUsuario(
      data.usuario as UsuarioRaw | UsuarioRaw[] | null
    ),
    cliente: normalizarCliente(
      data.cliente as ClienteRaw | ClienteRaw[] | null
    ),
    items,
  }
}