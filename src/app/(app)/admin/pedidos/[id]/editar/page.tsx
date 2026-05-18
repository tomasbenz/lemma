// src/app/(app)/admin/pedidos/[id]/editar/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeGestionarPedido } from '@/lib/auth/permisos'
import { createClient } from '@/lib/supabase/server'
import { listarProductosCaja } from '@/lib/queries/productos-caja'
import { EditarPedidoView } from './_components/editar-pedido-view'

export const metadata = {
  title: 'Editar pedido',
}

type Params = Promise<{ id: string }>

export default async function EditarPedidoPage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { id } = await params

  // Defense in depth sobre RLS: sin empresa_id no hay pedido editable.
  if (!user.empresa_id) {
    redirect('/admin/pedidos')
  }

  const supabase = await createClient()

  const { data: pedido } = await supabase
    .from('ventas')
    .select('id, numero, estado, cliente_id, usuario_id')
    .eq('id', id)
    .eq('empresa_id', user.empresa_id)
    .maybeSingle()

  if (!pedido || pedido.estado !== 'guardada') {
    redirect(`/admin/pedidos/${id}`)
  }

  // Vendedora solo puede editar sus propios pedidos.
  if (!puedeGestionarPedido(user, pedido.usuario_id)) {
    redirect('/admin/pedidos')
  }

  const { data: itemsRaw } = await supabase
    .from('items_venta')
    .select(
      `
      id,
      variante_id,
      producto_nombre,
      producto_sku,
      variante_sku,
      variante_color,
      variante_talle,
      cantidad,
      precio_unitario_neto,
      subtotal_neto
    `
    )
    .eq('venta_id', id)
    .order('created_at', { ascending: true })

  const productos = await listarProductosCaja()

  return (
    <EditarPedidoView
      pedidoId={pedido.id}
      pedidoNumero={pedido.numero}
      itemsIniciales={itemsRaw ?? []}
      productos={productos}
    />
  )
}
