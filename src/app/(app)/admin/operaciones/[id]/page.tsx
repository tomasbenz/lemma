import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  obtenerOperacion,
  resolverProductosPorIds,
} from '@/lib/queries/operaciones'
import { obtenerDetallePrecios } from './_actions/obtener-detalle-precios'
import { OperacionDetalle } from './_components/operacion-detalle'

export const metadata = {
  title: 'Detalle de operación',
}

export default async function OperacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/admin')

  const { id } = await params
  const operacion = await obtenerOperacion(id)
  if (!operacion) notFound()

  const [productos, detalle] = await Promise.all([
    resolverProductosPorIds(operacion.ids_afectados),
    obtenerDetallePrecios(id),
  ])
  const esReversion = operacion.accion === 'reversion_precios'

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <OperacionDetalle
          operacion={operacion}
          productos={productos}
          detalle={detalle}
          esReversion={esReversion}
        />
      </div>
    </div>
  )
}
