// src/app/(app)/admin/pedidos/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  puedeCobrar,
  restringirAPedidosPropios,
} from '@/lib/auth/permisos'
import { obtenerPedido } from '@/lib/queries/pedidos'
import { cargarClientesCaja } from '@/lib/queries/clientes-caja'
import { listarHistorialVenta } from '@/lib/queries/historial-venta'
import { HistorialCambios } from '@/components/historial-cambios/historial-cambios'
import { PedidoDetalleView } from './_components/pedido-detalle-view'
import { MarcarVistoEffect } from './_components/marcar-visto-effect'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const pedido = await obtenerPedido(id)
  return {
    title: pedido ? `Pedido #${pedido.numero}` : 'Pedido no encontrado',
  }
}

export default async function PedidoDetallePage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { id } = await params
  const restringirUsuarioId = restringirAPedidosPropios(user)
  const puedeFinalizar = puedeCobrar(user.rol)

  const [pedido, clientes, eventos] = await Promise.all([
    obtenerPedido(id, { restringirUsuarioId }),
    cargarClientesCaja(),
    user.empresa_id
      ? listarHistorialVenta(id, user.empresa_id)
      : Promise.resolve([]),
  ])

  if (!pedido) notFound()

  return (
    <>
      {/* Marcar como visto solo lo hace admin (es bandeja de pendientes
          que ven los admins, no las vendedoras). */}
      {puedeFinalizar && <MarcarVistoEffect pedidoId={pedido.id} />}
      <PedidoDetalleView
        pedido={pedido}
        clientes={clientes}
        puedeFinalizar={puedeFinalizar}
      />
      <div className="px-3 md:px-4 lg:px-6 pb-6">
        <div className="max-w-7xl mx-auto">
          <HistorialCambios eventos={eventos} />
        </div>
      </div>
    </>
  )
}
