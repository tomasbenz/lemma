import {
  listarOperaciones,
  obtenerFacetasOperaciones,
} from '@/lib/queries/operaciones'
import { OperacionesContent } from './operaciones-content'

const PER_PAGE = 50

export async function OperacionesView({
  searchParams,
}: {
  searchParams: {
    acciones?: string
    desde?: string
    hasta?: string
    omitidos?: string
    page?: string
  }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1)
  const acciones = searchParams.acciones
    ? searchParams.acciones.split(',').filter(Boolean)
    : []

  const [{ operaciones, total }, facetas] = await Promise.all([
    listarOperaciones({
      acciones,
      desde: searchParams.desde,
      hasta: searchParams.hasta,
      soloConOmitidos: searchParams.omitidos === '1',
      page,
      perPage: PER_PAGE,
    }),
    obtenerFacetasOperaciones(),
  ])

  return (
    <OperacionesContent
      operaciones={operaciones}
      total={total}
      page={page}
      perPage={PER_PAGE}
      accionesSeleccionadas={acciones}
      soloConOmitidos={searchParams.omitidos === '1'}
      facetas={facetas}
    />
  )
}
