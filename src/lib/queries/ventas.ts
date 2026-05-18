import { createClient } from '@/lib/supabase/server'

export type VentaListado = {
  id: string
  numero: number
  created_at: string
  closed_at: string | null
  canal: string
  estado: 'abierta' | 'guardada' | 'cerrada' | 'anulada'
  subtotal_neto: number
  descuento_total: number
  total: number
  tipo_factura: 'sin_factura' | 'factura_a' | 'factura_b' | 'factura_c'
  monto_facturado: number
  nota_interna: string | null
  usuario: {
    id: string
    nombre_completo: string | null
    email: string
  } | null
  cliente: {
    id: string
    razon_social: string
  } | null
  /**
   * Nombre alternativo del cliente para mostrar en listado/detalle/ticket.
   * Cuando está seteado, sobreescribe la razón social del cliente.
   */
  nombre_cliente_custom: string | null
  items_count: number
  items_cantidad_total: number
}

export type ListarVentasOptions = {
  desde?: string
  hasta?: string
  estado?: VentaListado['estado']
  tipoFactura?: VentaListado['tipo_factura']
  usuarioId?: string
  clienteId?: string
  busqueda?: string
  orden?: 'fecha_desc' | 'fecha_asc' | 'total_desc' | 'total_asc' | 'numero_desc'
  limit?: number
  offset?: number
}

/**
 * Lista ventas con filtros y paginación.
 *
 * Usa la vista `ventas_con_resumen` que incluye items_count agregado,
 * evitando N+1 queries.
 *
 * Búsqueda:
 *   - Solo dígitos (con o sin # y espacios) → búsqueda por número exacto.
 *   - Cualquier otra cosa → búsqueda ILIKE en nombre_cliente_custom.
 *
 * Los totales devueltos corresponden a TODO el resultado filtrado,
 * no solo a la página visible.
 */
export async function listarVentas(options: ListarVentasOptions = {}) {
  const supabase = await createClient()

  const {
    desde,
    hasta,
    estado,
    tipoFactura,
    usuarioId,
    clienteId,
    busqueda = '',
    orden = 'fecha_desc',
    limit = 50,
    offset = 0,
  } = options

  // Parsear búsqueda:
  // - Si es solo dígitos (con # o espacios alrededor) → número exacto.
  // - Si tiene letras o caracteres no numéricos → búsqueda en nombre_cliente_custom.
  const busquedaTrim = busqueda.trim()
  const busquedaLimpia = busquedaTrim.replace(/[#\s]/g, '')
  let numeroExacto: number | null = null
  let busquedaTexto: string | null = null

  if (busquedaTrim) {
    if (/^[#\s]*\d+[#\s]*$/.test(busquedaTrim)) {
      const n = parseInt(busquedaLimpia, 10)
      if (!isNaN(n)) numeroExacto = n
    } else {
      // Sanitizar para evitar romper el filtro ilike
      const sanitizado = busquedaTrim.replace(/[,()%*]/g, ' ').trim()
      if (sanitizado) {
        busquedaTexto = sanitizado
      }
    }
  }

  let query = supabase
    .from('ventas_con_resumen')
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
      tipo_factura,
      monto_facturado,
      nota_interna,
      nombre_cliente_custom,
      items_count,
      items_cantidad_total,
      usuario:usuarios!ventas_usuario_id_fkey(id, nombre_completo, email),
      cliente:clientes!ventas_cliente_id_fkey(id, razon_social)
    `,
      { count: 'exact' }
    )

  if (desde) query = query.gte('created_at', desde)
  if (hasta) query = query.lte('created_at', hasta)
  if (estado) query = query.eq('estado', estado)
  if (tipoFactura) query = query.eq('tipo_factura', tipoFactura)
  if (usuarioId) query = query.eq('usuario_id', usuarioId)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (numeroExacto !== null) query = query.eq('numero', numeroExacto)
  if (busquedaTexto) {
    query = query.ilike('nombre_cliente_custom', `%${busquedaTexto}%`)
  }

  switch (orden) {
    case 'fecha_desc':
      query = query.order('created_at', { ascending: false })
      break
    case 'fecha_asc':
      query = query.order('created_at', { ascending: true })
      break
    case 'total_desc':
      query = query.order('total', { ascending: false })
      break
    case 'total_asc':
      query = query.order('total', { ascending: true })
      break
    case 'numero_desc':
      query = query.order('numero', { ascending: false })
      break
  }

  query = query.range(offset, offset + limit - 1)

  // Ejecutar en paralelo: listado + totales agregados de todo el filtro
  const [ventasResult, totalesResult] = await Promise.all([
    query,
    supabase.rpc('ventas_totales_filtrados', {
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
      p_estado: estado ?? null,
      p_tipo_factura: tipoFactura ?? null,
      p_usuario_id: usuarioId ?? null,
      p_cliente_id: clienteId ?? null,
      p_numero: numeroExacto,
      p_busqueda_texto: busquedaTexto,
    } as never),
  ])

  const { data, error, count } = ventasResult

  if (error) {
    console.error('[listarVentas] Error:', error.message)
    throw new Error('Error al listar ventas')
  }

  const ventas: VentaListado[] = (data ?? []).map((v) => {
    const usuarioRaw = v.usuario as
      | { id: string; nombre_completo: string | null; email: string }
      | Array<{ id: string; nombre_completo: string | null; email: string }>
      | null
    const usuario = Array.isArray(usuarioRaw)
      ? usuarioRaw[0] ?? null
      : usuarioRaw

    const clienteRaw = v.cliente as
      | { id: string; razon_social: string }
      | Array<{ id: string; razon_social: string }>
      | null
    const cliente = Array.isArray(clienteRaw)
      ? clienteRaw[0] ?? null
      : clienteRaw

    return {
      id: v.id as string,
      numero: v.numero as number,
      created_at: v.created_at as string,
      closed_at: v.closed_at as string | null,
      canal: v.canal as string,
      estado: v.estado as VentaListado['estado'],
      subtotal_neto: v.subtotal_neto as number,
      descuento_total: v.descuento_total as number,
      total: v.total as number,
      tipo_factura: v.tipo_factura as VentaListado['tipo_factura'],
      monto_facturado: v.monto_facturado as number,
      nota_interna: v.nota_interna as string | null,
      usuario: usuario ?? null,
      cliente: cliente ?? null,
      nombre_cliente_custom:
        (v.nombre_cliente_custom as string | null) ?? null,
      items_count: (v.items_count as number) ?? 0,
      items_cantidad_total: (v.items_cantidad_total as number) ?? 0,
    }
  })

  // Totales globales del filtro (no solo de la página)
  const totalesData = totalesResult.data as
    | {
        cantidad?: number
        monto_total_neto?: number
        unidades_vendidas?: number
      }
    | null

  const totales = {
    cantidad: totalesData?.cantidad ?? 0,
    montoTotal: totalesData?.monto_total_neto ?? 0,
    unidadesVendidas: totalesData?.unidades_vendidas ?? 0,
  }

  return {
    ventas,
    total: count ?? 0,
    totales,
  }
}

/**
 * Obtiene el detalle completo de una venta con sus items y medios de pago.
 */
export async function obtenerVenta(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ventas')
    .select(
      `
      *,
      usuario:usuarios!ventas_usuario_id_fkey(id, nombre_completo, email),
      cliente:clientes!ventas_cliente_id_fkey(id, razon_social, cuit, cond_iva),
      items_venta(*),
      medios_pago_venta(*)
    `
    )
    .eq('id', id)
    .single()

  if (error) {
    console.error('[obtenerVenta] Error:', error.message)
    return null
  }

  return data
}