// src/app/(app)/admin/turnos/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarTurnos, type FiltrosTurnos } from '@/lib/queries/turnos'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TurnosTabla } from './_components/turnos-tabla'

export const metadata = {
  title: 'Turnos de caja',
}

type SearchParams = Promise<{
  estado?: string
  desde?: string
  hasta?: string
  pagina?: string
}>

export default async function TurnosPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const params = await searchParams
  const pagina = Math.max(1, Number.parseInt(params.pagina ?? '1', 10) || 1)
  const estadoParam = params.estado
  const estado: FiltrosTurnos['estado'] =
    estadoParam === 'abiertos' || estadoParam === 'cerrados'
      ? estadoParam
      : 'todos'

  const filtros: FiltrosTurnos = {
    estado,
    desde: params.desde || null,
    hasta: params.hasta || null,
    pagina,
    porPagina: 20,
  }

  const { rows, total, porPagina } = await listarTurnos(filtros)
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))

  function hrefFiltro(
    overrides: Partial<{
      estado: string
      pagina: number
    }>
  ): string {
    const sp = new URLSearchParams()
    const next = {
      estado: overrides.estado ?? estado,
      pagina: String(overrides.pagina ?? pagina),
    }
    if (next.estado && next.estado !== 'todos') sp.set('estado', next.estado)
    if (filtros.desde) sp.set('desde', filtros.desde)
    if (filtros.hasta) sp.set('hasta', filtros.hasta)
    if (next.pagina && next.pagina !== '1') sp.set('pagina', next.pagina)
    const q = sp.toString()
    return q ? `/admin/turnos?${q}` : '/admin/turnos'
  }

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Turnos de caja
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Historial de aperturas y cierres con diferencias declaradas.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button asChild variant={estado === 'todos' ? 'default' : 'outline'} size="sm">
            <Link href={hrefFiltro({ estado: 'todos', pagina: 1 })}>Todos</Link>
          </Button>
          <Button
            asChild
            variant={estado === 'abiertos' ? 'default' : 'outline'}
            size="sm"
          >
            <Link href={hrefFiltro({ estado: 'abiertos', pagina: 1 })}>
              Abiertos
            </Link>
          </Button>
          <Button
            asChild
            variant={estado === 'cerrados' ? 'default' : 'outline'}
            size="sm"
          >
            <Link href={hrefFiltro({ estado: 'cerrados', pagina: 1 })}>
              Cerrados
            </Link>
          </Button>
        </div>

        <Card className="p-0 overflow-hidden">
          <TurnosTabla rows={rows} />
        </Card>

        {total > porPagina && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              Página {pagina} de {totalPaginas} · {total} turnos
            </p>
            <div className="flex gap-2">
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={pagina <= 1}
              >
                <Link
                  href={hrefFiltro({ pagina: Math.max(1, pagina - 1) })}
                  aria-disabled={pagina <= 1}
                >
                  Anterior
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={pagina >= totalPaginas}
              >
                <Link
                  href={hrefFiltro({ pagina: Math.min(totalPaginas, pagina + 1) })}
                  aria-disabled={pagina >= totalPaginas}
                >
                  Siguiente
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
