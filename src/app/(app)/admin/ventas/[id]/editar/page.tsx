// src/app/(app)/admin/ventas/[id]/editar/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { listarProductosCaja } from '@/lib/queries/productos-caja'
import { EditarVentaView } from './_components/editar-venta-view'

export const metadata = {
  title: 'Editar venta',
}

type Params = Promise<{ id: string }>

export default async function EditarVentaPage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { id } = await params

  if (!user.empresa_id) {
    redirect('/admin/ventas')
  }

  const supabase = await createClient()

  const { data: venta } = await supabase
    .from('ventas')
    .select('id, numero, estado, total, subtotal_neto')
    .eq('id', id)
    .eq('empresa_id', user.empresa_id)
    .maybeSingle()

  if (!venta || venta.estado !== 'cerrada') {
    redirect(`/admin/ventas/${id}`)
  }

  const [itemsResult, facturaResult, productos] = await Promise.all([
    supabase
      .from('items_venta')
      .select(
        `
        id,
        variante_id,
        producto_nombre,
        producto_sku,
        variante_sku,
        variante_atributos,
        cantidad,
        precio_unitario_neto,
        subtotal_neto
      `
      )
      .eq('venta_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('facturas_afip')
      .select('id, numero_comprobante, punto_venta, cae, tipo_factura')
      .eq('venta_id', id)
      .in('estado', ['aprobada', 'aprobada_sin_persistir'])
      .is('factura_asociada_id', null)
      .limit(1)
      .maybeSingle(),
    listarProductosCaja(),
  ])

  return (
    <EditarVentaView
      ventaId={venta.id}
      ventaNumero={venta.numero}
      ventaTotal={venta.total}
      itemsIniciales={itemsResult.data ?? []}
      facturaAprobada={facturaResult.data ?? null}
      productos={productos}
    />
  )
}
