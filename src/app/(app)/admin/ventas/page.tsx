// src/app/(app)/admin/ventas/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarVentas, type ListarVentasOptions } from '@/lib/queries/ventas'
import { obtenerCliente, listarClientes } from '@/lib/queries/clientes'
import { VentasView } from './_components/ventas-view'
import { VentasListSkeleton } from './_components/ventas-list-skeleton'
import type { ClienteOption } from '@/components/app/cliente-combobox'

export const metadata = {
  title: 'Ventas',
}

type SearchParams = Promise<{
  desde?: string
  hasta?: string
  estado?: string
  tipoFactura?: string
  busqueda?: string
  orden?: string
  clienteId?: string
}>

export default async function VentasPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const params = await searchParams

  const filters: ListarVentasOptions = {
    desde: params.desde,
    hasta: params.hasta,
    estado: params.estado as ListarVentasOptions['estado'],
    tipoFactura: params.tipoFactura as ListarVentasOptions['tipoFactura'],
    busqueda: params.busqueda,
    clienteId: params.clienteId,
    orden: (params.orden as ListarVentasOptions['orden']) ?? 'fecha_desc',
    limit: 100,
  }

  // Cargar lista light de clientes (todos, activos e inactivos) para el combobox.
  const { clientes: clientesRaw } = await listarClientes({
    soloActivos: false,
    orden: 'nombre_asc',
    limit: 500,
  })

  const clientesParaCombobox: ClienteOption[] = clientesRaw.map((c) => ({
    id: c.id,
    razon_social: c.razon_social,
    cuit: c.cuit ?? null,
  }))

  // Si hay clienteId activo, traer el detalle para mostrar el chip
  const clienteFiltrado = filters.clienteId
    ? await obtenerCliente(filters.clienteId)
    : null

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Ventas
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Historial de ventas cerradas
            </p>
          </div>
          {/* El botón de export ahora vive dentro de VentasView, así
              accede a los IDs filtrados client-side (búsqueda live + filtros) */}
        </div>

        <Suspense fallback={<VentasListSkeleton />}>
          <VentasContent
            filters={filters}
            clienteFiltrado={
              clienteFiltrado
                ? {
                    id: clienteFiltrado.id,
                    razon_social: clienteFiltrado.razon_social,
                  }
                : null
            }
            clientesParaCombobox={clientesParaCombobox}
          />
        </Suspense>
      </div>
    </div>
  )
}

async function VentasContent({
  filters,
  clienteFiltrado,
  clientesParaCombobox,
}: {
  filters: ListarVentasOptions
  clienteFiltrado: { id: string; razon_social: string } | null
  clientesParaCombobox: ClienteOption[]
}) {
  const { ventas, total, totales } = await listarVentas(filters)

  return (
    <VentasView
      ventas={ventas}
      total={total}
      totales={totales}
      filters={filters}
      clienteFiltrado={clienteFiltrado}
      clientesParaCombobox={clientesParaCombobox}
    />
  )
}