// src/lib/queries/turnos.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type TurnoRow = {
  id: string
  empresa_id: string
  caja_id: string
  caja_nombre: string | null
  sucursal_nombre: string | null
  usuario_apertura_id: string
  usuario_cierre_id: string | null
  abierto_at: string
  cerrado_at: string | null
  base_inicial: number
  nota_apertura: string | null
  total_declarado: number | null
  diferencia: number | null
  nota_cierre: string | null
  forzado_por_admin: boolean
  motivo_forzado: string | null
  usuario_apertura: {
    id: string
    nombre_completo: string | null
    email: string
  } | null
  usuario_cierre: {
    id: string
    nombre_completo: string | null
    email: string
  } | null
}

export type TurnoActivo = {
  id: string
  caja_id: string
  abierto_at: string
  base_inicial: number
  nota_apertura: string | null
  usuario_apertura_id: string
  usuario_apertura_nombre: string | null
}

export type ResumenTurno = {
  turno_id: string
  base_inicial: number
  total_efectivo_ventas: number
  total_teorico_efectivo: number
  total_declarado: number | null
  diferencia: number | null
  totales_por_medio_pago: Array<{
    medio: string
    monto: number
    cantidad: number
  }>
  cantidad_ventas: number
  cantidad_anulaciones: number
  cerrado_at: string | null
  forzado_por_admin: boolean
}

export type FiltrosTurnos = {
  usuarioAperturaId?: string | null
  cajaId?: string | null
  estado?: 'todos' | 'abiertos' | 'cerrados'
  desde?: string | null
  hasta?: string | null
  pagina?: number
  porPagina?: number
}

export type ListadoTurnos = {
  rows: TurnoRow[]
  total: number
  pagina: number
  porPagina: number
}

type UsuarioJoin = {
  id: string
  nombre_completo: string | null
  email: string
}

function flat<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

/**
 * Devuelve el turno abierto de la caja default de la empresa, o null.
 * Si la empresa todavía no tiene caja default o no hay turno abierto,
 * retorna null.
 */
export async function obtenerTurnoActivoDeEmpresa(
  empresaId: string
): Promise<TurnoActivo | null> {
  const supabase = await createClient()

  const { data: cajaData, error: cajaError } = await supabase.rpc(
    'get_default_caja_id',
    { p_empresa_id: empresaId }
  )

  if (cajaError || !cajaData) {
    if (cajaError) console.error('[obtenerTurnoActivoDeEmpresa] caja:', cajaError)
    return null
  }

  const cajaId = cajaData as unknown as string

  const { data, error } = await supabase
    .from('turnos_caja')
    .select(
      `
      id,
      caja_id,
      abierto_at,
      base_inicial,
      nota_apertura,
      usuario_apertura_id,
      usuario_apertura:usuarios!turnos_caja_usuario_apertura_id_fkey(
        nombre_completo
      )
    `
    )
    .eq('caja_id', cajaId)
    .is('cerrado_at', null)
    .maybeSingle()

  if (error) {
    console.error('[obtenerTurnoActivoDeEmpresa] Error:', error)
    return null
  }

  if (!data) return null

  const ua = flat(
    data.usuario_apertura as
      | { nombre_completo: string | null }
      | { nombre_completo: string | null }[]
      | null
  )

  return {
    id: data.id,
    caja_id: data.caja_id,
    abierto_at: data.abierto_at,
    base_inicial: Number(data.base_inicial),
    nota_apertura: data.nota_apertura,
    usuario_apertura_id: data.usuario_apertura_id,
    usuario_apertura_nombre: ua?.nombre_completo ?? null,
  }
}

/**
 * Lista turnos paginados con filtros. Se ordena por abierto_at DESC
 * (turnos más recientes primero).
 */
export async function listarTurnos(
  filtros: FiltrosTurnos = {}
): Promise<ListadoTurnos> {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const porPagina = Math.min(100, Math.max(1, filtros.porPagina ?? 20))
  const estado = filtros.estado ?? 'todos'

  let query = supabase
    .from('turnos_caja')
    .select(
      `
      id,
      empresa_id,
      caja_id,
      usuario_apertura_id,
      usuario_cierre_id,
      abierto_at,
      cerrado_at,
      base_inicial,
      nota_apertura,
      total_declarado,
      diferencia,
      nota_cierre,
      forzado_por_admin,
      motivo_forzado,
      caja:cajas(
        nombre,
        sucursal:sucursales(nombre)
      ),
      usuario_apertura:usuarios!turnos_caja_usuario_apertura_id_fkey(
        id, nombre_completo, email
      ),
      usuario_cierre:usuarios!turnos_caja_usuario_cierre_id_fkey(
        id, nombre_completo, email
      )
    `,
      { count: 'exact' }
    )
    .order('abierto_at', { ascending: false })

  if (estado === 'abiertos') {
    query = query.is('cerrado_at', null)
  } else if (estado === 'cerrados') {
    query = query.not('cerrado_at', 'is', null)
  }
  if (filtros.usuarioAperturaId) {
    query = query.eq('usuario_apertura_id', filtros.usuarioAperturaId)
  }
  if (filtros.cajaId) {
    query = query.eq('caja_id', filtros.cajaId)
  }
  if (filtros.desde) {
    query = query.gte('abierto_at', filtros.desde)
  }
  if (filtros.hasta) {
    query = query.lte('abierto_at', filtros.hasta)
  }

  const from = (pagina - 1) * porPagina
  const to = from + porPagina - 1
  query = query.range(from, to)

  const { data, error, count } = await query

  if (error) {
    console.error('[listarTurnos] Error:', error)
    return { rows: [], total: 0, pagina, porPagina }
  }

  type CajaJoin = {
    nombre: string | null
    sucursal: { nombre: string | null } | { nombre: string | null }[] | null
  }

  const rows: TurnoRow[] = (data ?? []).map((r) => {
    const caja = flat(r.caja as CajaJoin | CajaJoin[] | null)
    const sucursal = caja
      ? flat(caja.sucursal as { nombre: string | null } | { nombre: string | null }[] | null)
      : null
    return {
      id: r.id,
      empresa_id: r.empresa_id,
      caja_id: r.caja_id,
      caja_nombre: caja?.nombre ?? null,
      sucursal_nombre: sucursal?.nombre ?? null,
      usuario_apertura_id: r.usuario_apertura_id,
      usuario_cierre_id: r.usuario_cierre_id,
      abierto_at: r.abierto_at,
      cerrado_at: r.cerrado_at,
      base_inicial: Number(r.base_inicial),
      nota_apertura: r.nota_apertura,
      total_declarado: r.total_declarado !== null ? Number(r.total_declarado) : null,
      diferencia: r.diferencia !== null ? Number(r.diferencia) : null,
      nota_cierre: r.nota_cierre,
      forzado_por_admin: r.forzado_por_admin,
      motivo_forzado: r.motivo_forzado,
      usuario_apertura: flat(
        r.usuario_apertura as UsuarioJoin | UsuarioJoin[] | null
      ),
      usuario_cierre: flat(
        r.usuario_cierre as UsuarioJoin | UsuarioJoin[] | null
      ),
    }
  })

  return {
    rows,
    total: count ?? 0,
    pagina,
    porPagina,
  }
}

/**
 * Obtiene un turno individual con su resumen calculado vía RPC.
 * Devuelve null si no existe o no pertenece a la empresa del caller.
 */
export async function obtenerTurno(
  id: string
): Promise<{ turno: TurnoRow; resumen: ResumenTurno } | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('turnos_caja')
    .select(
      `
      id,
      empresa_id,
      caja_id,
      usuario_apertura_id,
      usuario_cierre_id,
      abierto_at,
      cerrado_at,
      base_inicial,
      nota_apertura,
      total_declarado,
      diferencia,
      nota_cierre,
      forzado_por_admin,
      motivo_forzado,
      caja:cajas(
        nombre,
        sucursal:sucursales(nombre)
      ),
      usuario_apertura:usuarios!turnos_caja_usuario_apertura_id_fkey(
        id, nombre_completo, email
      ),
      usuario_cierre:usuarios!turnos_caja_usuario_cierre_id_fkey(
        id, nombre_completo, email
      )
    `
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[obtenerTurno] Error:', error)
    return null
  }
  if (!data) return null

  type CajaJoin = {
    nombre: string | null
    sucursal: { nombre: string | null } | { nombre: string | null }[] | null
  }
  const caja = flat(data.caja as CajaJoin | CajaJoin[] | null)
  const sucursal = caja
    ? flat(caja.sucursal as { nombre: string | null } | { nombre: string | null }[] | null)
    : null

  const turno: TurnoRow = {
    id: data.id,
    empresa_id: data.empresa_id,
    caja_id: data.caja_id,
    caja_nombre: caja?.nombre ?? null,
    sucursal_nombre: sucursal?.nombre ?? null,
    usuario_apertura_id: data.usuario_apertura_id,
    usuario_cierre_id: data.usuario_cierre_id,
    abierto_at: data.abierto_at,
    cerrado_at: data.cerrado_at,
    base_inicial: Number(data.base_inicial),
    nota_apertura: data.nota_apertura,
    total_declarado:
      data.total_declarado !== null ? Number(data.total_declarado) : null,
    diferencia: data.diferencia !== null ? Number(data.diferencia) : null,
    nota_cierre: data.nota_cierre,
    forzado_por_admin: data.forzado_por_admin,
    motivo_forzado: data.motivo_forzado,
    usuario_apertura: flat(
      data.usuario_apertura as UsuarioJoin | UsuarioJoin[] | null
    ),
    usuario_cierre: flat(
      data.usuario_cierre as UsuarioJoin | UsuarioJoin[] | null
    ),
  }

  const { data: resumenRaw, error: resumenError } = await supabase.rpc(
    'resumen_turno',
    { p_turno_id: id }
  )

  if (resumenError) {
    console.error('[obtenerTurno] resumen:', resumenError)
    return null
  }

  const resumen = resumenRaw as unknown as Database['public']['Functions']['resumen_turno']['Returns']
  if (!resumen || typeof resumen !== 'object') return null

  const r = resumen as Record<string, unknown>
  const tipados: ResumenTurno = {
    turno_id: String(r.turno_id),
    base_inicial: Number(r.base_inicial ?? 0),
    total_efectivo_ventas: Number(r.total_efectivo_ventas ?? 0),
    total_teorico_efectivo: Number(r.total_teorico_efectivo ?? 0),
    total_declarado:
      r.total_declarado === null || r.total_declarado === undefined
        ? null
        : Number(r.total_declarado),
    diferencia:
      r.diferencia === null || r.diferencia === undefined
        ? null
        : Number(r.diferencia),
    totales_por_medio_pago: Array.isArray(r.totales_por_medio_pago)
      ? (r.totales_por_medio_pago as Array<Record<string, unknown>>).map(
          (m) => ({
            medio: String(m.medio ?? ''),
            monto: Number(m.monto ?? 0),
            cantidad: Number(m.cantidad ?? 0),
          })
        )
      : [],
    cantidad_ventas: Number(r.cantidad_ventas ?? 0),
    cantidad_anulaciones: Number(r.cantidad_anulaciones ?? 0),
    cerrado_at: r.cerrado_at ? String(r.cerrado_at) : null,
    forzado_por_admin: Boolean(r.forzado_por_admin),
  }

  return { turno, resumen: tipados }
}

export type TotalMedio = {
  medio: string
  monto: number
}

export type ResumenDiaTurnos = {
  dia: string // YYYY-MM-DD (en TZ Argentina)
  turnos: TurnoRow[]
  total_cobrado: number
  cantidad_turnos: number
  declarado_total: number // suma de total_declarado, ignorando null
  diferencia_total: number // suma de diferencia, ignorando null
  por_medio: TotalMedio[] // ordenado por monto desc, sin medios con 0
  tiene_turno_abierto: boolean
}

/**
 * Dado un array de TurnoRow ya cargado, traer los totales por medio de pago
 * agrupados por turno (para poder sumar por día). Hace UNA query a
 * medios_pago_venta filtrando por turno_id IN (...) y estado venta cerrada.
 *
 * Devuelve un Map<turno_id, Map<medio, monto>> que el caller usa para armar
 * los grupos por día. Multi-tenant: medios_pago_venta tiene empresa_id propio,
 * así que RLS aplica directo. Además, los turnoIds vienen de listarTurnos
 * (que también pasa por RLS), así que solo turnos de la empresa del caller
 * matchean.
 */
export async function obtenerTotalesPorMedioDeTurnos(
  turnoIds: string[]
): Promise<Map<string, Map<string, number>>> {
  if (turnoIds.length === 0) return new Map()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('medios_pago_venta')
    .select(
      `
      medio,
      monto,
      venta:ventas!inner(turno_id, estado)
    `
    )
    .in('venta.turno_id', turnoIds)
    .eq('venta.estado', 'cerrada')

  if (error || !data) {
    if (error) console.error('[obtenerTotalesPorMedioDeTurnos]', error)
    return new Map()
  }

  type VentaJoin = { turno_id: string | null; estado: string }

  const result = new Map<string, Map<string, number>>()
  for (const row of data) {
    const venta = flat(row.venta as VentaJoin | VentaJoin[] | null)
    const turnoId = venta?.turno_id ?? null
    if (!turnoId) continue
    const medio = String(row.medio)
    const monto = Number(row.monto) || 0
    if (!result.has(turnoId)) result.set(turnoId, new Map())
    const mapaTurno = result.get(turnoId)!
    mapaTurno.set(medio, (mapaTurno.get(medio) ?? 0) + monto)
  }
  return result
}

/**
 * Agrupa turnos por día y agrega resumen de cada día (cantidades, totales,
 * desglose por medio de pago). El caller pasa los turnos ya filtrados y
 * paginados, y este helper hace la query lateral por medios.
 */
export async function agruparTurnosPorDia(
  turnos: TurnoRow[]
): Promise<ResumenDiaTurnos[]> {
  if (turnos.length === 0) return []

  const turnoIds = turnos.map((t) => t.id)
  const mediosPorTurno = await obtenerTotalesPorMedioDeTurnos(turnoIds)

  const grupos = new Map<string, TurnoRow[]>()
  for (const t of turnos) {
    // Agrupar por día en TZ Argentina (en-CA → YYYY-MM-DD).
    // Un turno abierto a las 23:00 ART (02:00 UTC del día siguiente) cae
    // correctamente en el día ART en el que se abrió.
    const dia = new Date(t.abierto_at).toLocaleDateString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    })
    if (!grupos.has(dia)) grupos.set(dia, [])
    grupos.get(dia)!.push(t)
  }

  const result: ResumenDiaTurnos[] = []
  for (const [dia, turnosDelDia] of grupos) {
    let declaradoTotal = 0
    let diferenciaTotal = 0
    const sumaPorMedio = new Map<string, number>()

    for (const t of turnosDelDia) {
      declaradoTotal += t.total_declarado ?? 0
      diferenciaTotal += t.diferencia ?? 0

      const medios = mediosPorTurno.get(t.id)
      if (medios) {
        for (const [medio, monto] of medios) {
          sumaPorMedio.set(medio, (sumaPorMedio.get(medio) ?? 0) + monto)
        }
      }
    }

    const por_medio: TotalMedio[] = Array.from(sumaPorMedio.entries())
      .filter(([, m]) => m > 0)
      .map(([medio, monto]) => ({ medio, monto }))
      .sort((a, b) => b.monto - a.monto)

    const total_cobrado = por_medio.reduce((s, m) => s + m.monto, 0)
    const tiene_turno_abierto = turnosDelDia.some((t) => t.cerrado_at === null)

    result.push({
      dia,
      turnos: turnosDelDia,
      total_cobrado,
      cantidad_turnos: turnosDelDia.length,
      declarado_total: declaradoTotal,
      diferencia_total: diferenciaTotal,
      por_medio,
      tiene_turno_abierto,
    })
  }

  // Día más reciente primero
  return result.sort((a, b) => (a.dia < b.dia ? 1 : -1))
}

export type VentaDeTurno = {
  id: string
  numero: number
  estado: string
  created_at: string
  closed_at: string | null
  total: number
  vendedor_nombre: string | null
  cliente_nombre: string | null
}

/**
 * Lista las ventas asociadas a un turno (cualquier estado).
 * Para la pantalla de detalle del turno.
 */
export async function listarVentasDeTurno(
  turnoId: string
): Promise<VentaDeTurno[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ventas')
    .select(
      `
      id,
      numero,
      estado,
      created_at,
      closed_at,
      total,
      nombre_cliente_custom,
      usuario:usuarios!ventas_usuario_id_fkey(nombre_completo, email),
      cliente:clientes(razon_social)
    `
    )
    .eq('turno_id', turnoId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[listarVentasDeTurno] Error:', error)
    return []
  }

  type UsuarioMin = { nombre_completo: string | null; email: string }
  type ClienteMin = { razon_social: string }

  return (data ?? []).map((r) => {
    const u = flat(r.usuario as UsuarioMin | UsuarioMin[] | null)
    const c = flat(r.cliente as ClienteMin | ClienteMin[] | null)
    return {
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      created_at: r.created_at,
      closed_at: r.closed_at,
      total: Number(r.total),
      vendedor_nombre: u?.nombre_completo ?? u?.email ?? null,
      cliente_nombre:
        c?.razon_social ?? (r.nombre_cliente_custom as string | null) ?? null,
    }
  })
}
