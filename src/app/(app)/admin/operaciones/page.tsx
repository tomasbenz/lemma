import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { OperacionesView } from './_components/operaciones-view'
import { OperacionesSkeleton } from './_components/operaciones-skeleton'

export const metadata = {
  title: 'Operaciones masivas',
}

type SearchParams = Promise<{
  acciones?: string
  desde?: string
  hasta?: string
  omitidos?: string
  page?: string
}>

export default async function OperacionesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/admin')

  const params = await searchParams

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Operaciones masivas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Historial de cambios masivos al catálogo: qué se modificó y qué se
            omitió.
          </p>
        </div>

        <Suspense fallback={<OperacionesSkeleton />}>
          <OperacionesView searchParams={params} />
        </Suspense>
      </div>
    </div>
  )
}
