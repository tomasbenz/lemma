'use server'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import type { ProductoGlobal, VentaGlobal } from './buscar-global-types'

export async function cargarProductosGlobal(): Promise<ProductoGlobal[]> {
  const user = await getCurrentUser()
  if (!user) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, sku_base, imagen_url, categoria')
    .eq('activo', true)
    .order('nombre', { ascending: true })
    .limit(500)

  if (error || !data) {
    console.error('[cargarProductosGlobal]', error)
    return []
  }

  return data.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    sku_base: p.sku_base,
    imagen_url: p.imagen_url,
    categoria: p.categoria,
  }))
}

export async function buscarVentasPorNumero(
  numero: number
): Promise<VentaGlobal[]> {
  const user = await getCurrentUser()
  if (!user || user.rol === 'vendedor') return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ventas')
    .select(
      `
      id,
      numero,
      created_at,
      total,
      cliente:clientes!ventas_cliente_id_fkey(razon_social)
    `
    )
    .eq('numero', numero)
    .limit(5)

  if (error || !data) {
    console.error('[buscarVentasPorNumero]', error)
    return []
  }

  return data.map((v) => {
    const clienteRaw = v.cliente as
      | { razon_social: string }
      | Array<{ razon_social: string }>
      | null
    const cliente = Array.isArray(clienteRaw) ? clienteRaw[0] ?? null : clienteRaw

    return {
      id: v.id,
      numero: v.numero,
      fecha: new Date(v.created_at).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      }),
      cliente: cliente?.razon_social ?? 'Consumidor final',
      total: v.total ?? 0,
    }
  })
}
