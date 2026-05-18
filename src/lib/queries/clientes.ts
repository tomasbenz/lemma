import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type {
  Cliente,
  ClienteConStats,
  CondIva,
  ListarClientesOptions,
} from './clientes-types'

export async function listarClientes(options: ListarClientesOptions = {}) {
  const supabase = await createClient()

  const {
    q = '',
    soloActivos = true,
    orden = 'nombre_asc',
    limit = 100,
    offset = 0,
  } = options

  let query = supabase
    .from('clientes')
    .select(
      `
      id,
      razon_social,
      cuit,
      cond_iva,
      email,
      telefono,
      domicilio,
      localidad,
      provincia,
      notas,
      activo,
      created_at,
      updated_at,
      ventas!ventas_cliente_id_fkey(id, total, estado)
    `,
      { count: 'exact' }
    )

  if (soloActivos) {
    query = query.eq('activo', true)
  }

  if (q.trim()) {
    const busq = q.trim()
    query = query.or(
      `razon_social.ilike.%${busq}%,cuit.ilike.%${busq}%,email.ilike.%${busq}%`
    )
  }

  switch (orden) {
    case 'nombre_asc':
      query = query.order('razon_social', { ascending: true })
      break
    case 'nombre_desc':
      query = query.order('razon_social', { ascending: false })
      break
    case 'fecha_desc':
      query = query.order('created_at', { ascending: false })
      break
  }

  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('[listarClientes]', error)
    throw new Error('Error al listar clientes')
  }

  const clientes: ClienteConStats[] = (data ?? []).map((c) => {
    const ventas = (c.ventas ?? []) as Array<{
      id: string
      total: number
      estado: string
    }>

    const ventasCerradas = ventas.filter((v) => v.estado === 'cerrada')
    const montoTotal = ventasCerradas.reduce((sum, v) => sum + v.total, 0)

    return {
      id: c.id,
      razon_social: c.razon_social,
      cuit: c.cuit,
      cond_iva: c.cond_iva as CondIva,
      email: c.email,
      telefono: c.telefono,
      domicilio: c.domicilio,
      localidad: c.localidad,
      provincia: c.provincia,
      notas: c.notas,
      activo: c.activo,
      created_at: c.created_at,
      updated_at: c.updated_at,
      cantidad_ventas: ventasCerradas.length,
      monto_total_vendido: montoTotal,
    }
  })

  return {
    clientes,
    total: count ?? 0,
  }
}

export async function obtenerCliente(id: string): Promise<Cliente | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select(
      `
      id,
      razon_social,
      cuit,
      cond_iva,
      email,
      telefono,
      domicilio,
      localidad,
      provincia,
      notas,
      activo,
      created_at,
      updated_at
    `
    )
    .eq('id', id)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    razon_social: data.razon_social,
    cuit: data.cuit,
    cond_iva: data.cond_iva as CondIva,
    email: data.email,
    telefono: data.telefono,
    domicilio: data.domicilio,
    localidad: data.localidad,
    provincia: data.provincia,
    notas: data.notas,
    activo: data.activo,
    created_at: data.created_at,
    updated_at: data.updated_at,
  }
}