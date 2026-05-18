// src/app/(app)/admin/pedidos/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { restringirAPedidosPropios, puedeCobrar } from '@/lib/auth/permisos'
import {
  listarPedidos,
  listarVendedoresConPedidos,
  type FiltrosPedidos,
} from '@/lib/queries/pedidos'
import { cargarClientesCaja } from '@/lib/queries/clientes-caja'
import { PedidosView } from './_components/pedidos-view'

export const metadata = {
  title: 'Pedidos',
}

type SearchParams = Promise<{
  alcance?: string
  vendedor?: string
}>

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams

  // Vendedora: SIEMPRE filtra a sus propios pedidos y nunca ve cerradas.
  const restringirUsuarioId = restringirAPedidosPropios(user)
  const esCaller = puedeCobrar(user.rol)

  // Para vendedora solo tiene sentido "pendientes" (pedidos guardados
  // que ella puede gestionar). No ve cerradas/anuladas.
  const alcanceRequerido: FiltrosPedidos['alcance'] =
    params.alcance === 'pendientes' ||
    params.alcance === 'todos' ||
    params.alcance === 'pendientes_y_recientes'
      ? params.alcance
      : 'pendientes_y_recientes'
  const alcance: FiltrosPedidos['alcance'] = esCaller
    ? alcanceRequerido
    : 'pendientes'

  // Para vendedora: no hay filtro por vendedor (siempre es ella).
  const vendedorId = esCaller ? params.vendedor || null : null

  const [pedidos, vendedores, clientes] = await Promise.all([
    listarPedidos({
      alcance,
      vendedorId,
      restringirUsuarioId,
    }),
    esCaller ? listarVendedoresConPedidos() : Promise.resolve([]),
    cargarClientesCaja(),
  ])

  return (
    <PedidosView
      pedidos={pedidos}
      vendedores={vendedores}
      alcance={alcance}
      clientes={clientes}
      puedeVerCerradas={esCaller}
    />
  )
}
