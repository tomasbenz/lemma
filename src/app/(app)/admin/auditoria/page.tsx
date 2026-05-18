import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  listarAuditoria,
  obtenerFacetasAuditoria,
  type FiltrosAuditoria,
} from '@/lib/queries/auditoria'
import { AuditoriaView } from './_components/auditoria-view'
import { AuditoriaSkeleton } from './_components/auditoria-skeleton'

export const metadata = {
  title: 'Auditoría',
}

type SearchParams = Promise<{
  entidad?: string
  accion?: string
  desde?: string
  hasta?: string
  page?: string
}>

export default async function AuditoriaPage({
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
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Auditoría
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Registro de acciones importantes. Útil para saber quién hizo qué y cuándo.
          </p>
        </div>

        <Suspense fallback={<AuditoriaSkeleton />}>
          <AuditoriaContent searchParams={params} />
        </Suspense>
      </div>
    </div>
  )
}

async function AuditoriaContent({
  searchParams,
}: {
  searchParams: { entidad?: string; accion?: string; desde?: string; hasta?: string; page?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1)
  const limit = 50
  const offset = (page - 1) * limit

  const filtros: FiltrosAuditoria = {
    entidad: searchParams.entidad,
    accion: searchParams.accion,
    desde: searchParams.desde,
    hasta: searchParams.hasta,
    limit,
    offset,
  }

  const [{ entries, total }, facetas] = await Promise.all([
    listarAuditoria(filtros),
    obtenerFacetasAuditoria(),
  ])

  return (
    <AuditoriaView
      entries={entries}
      total={total}
      page={page}
      limit={limit}
      filtros={filtros}
      facetas={facetas}
    />
  )
}