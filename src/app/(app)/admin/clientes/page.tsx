// src/app/(app)/admin/clientes/page.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarClientes } from '@/lib/queries/clientes'
import type { ListarClientesOptions } from '@/lib/queries/clientes-types'
import { Button } from '@/components/ui/button'
import { ClientesView } from './_components/clientes-view'
import { ClientesListSkeleton } from './_components/clientes-list-skeleton'

export const metadata = {
  title: 'Clientes',
}

type SearchParams = Promise<{
  q?: string
  orden?: string
  estado?: string
}>

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const params = await searchParams

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Clientes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Base de clientes para facturación y seguimiento
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/clientes/nuevo">
              <Plus className="size-4 mr-2" />
              Nuevo cliente
            </Link>
          </Button>
        </div>

        <Suspense fallback={<ClientesListSkeleton />}>
          <ClientesContent searchParams={params} />
        </Suspense>
      </div>
    </div>
  )
}

async function ClientesContent({
  searchParams,
}: {
  searchParams: { q?: string; orden?: string; estado?: string }
}) {
  const filters: ListarClientesOptions = {
    q: searchParams.q ?? '',
    orden: (searchParams.orden as ListarClientesOptions['orden']) ?? 'nombre_asc',
    soloActivos: searchParams.estado !== 'todos',
  }

  const { clientes, total } = await listarClientes(filters)

  return (
    <ClientesView clientes={clientes} total={total} filters={filters} />
  )
}