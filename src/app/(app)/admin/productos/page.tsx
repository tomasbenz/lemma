import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { listarProductos, listarCategorias } from '@/lib/queries/productos'
import { Button } from '@/components/ui/button'
import { ProductosView } from './_components/productos-view'
import { ProductosListSkeleton } from './_components/productos-list-skeleton'

export const metadata = {
  title: 'Productos',
}

type SearchParams = Promise<{
  q?: string
  orden?: string
  estado?: string
  stock?: string
  categoria?: string
  page?: string
  per_page?: string
}>

const PER_PAGE_OPCIONES = [20, 50, 100] as const
const PER_PAGE_DEFAULT = 50

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const puedeEditar = puedeEditarCatalogo(user.rol)
  const params = await searchParams

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Productos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {puedeEditar
                ? 'Gestión del catálogo'
                : 'Catálogo · ajustá stock desde el detalle'}
            </p>
          </div>
          {puedeEditar && (
            <Button asChild>
              <Link href="/admin/productos/nuevo">
                <Plus className="size-4 mr-2" />
                Nuevo producto
              </Link>
            </Button>
          )}
        </div>

        {/* Lista */}
        <Suspense fallback={<ProductosListSkeleton />}>
          <ProductosListWrapper searchParams={params} puedeEditar={puedeEditar} />
        </Suspense>
      </div>
    </div>
  )
}

async function ProductosListWrapper({
  searchParams,
  puedeEditar,
}: {
  searchParams: {
    q?: string
    orden?: string
    estado?: string
    stock?: string
    categoria?: string
    page?: string
    per_page?: string
  }
  puedeEditar: boolean
}) {
  const filters = {
    q: searchParams.q ?? '',
    orden: searchParams.orden ?? 'nombre_asc',
    estado: searchParams.estado ?? 'activos',
    stock: searchParams.stock ?? '',
    categoria: searchParams.categoria ?? '',
  }

  // Parsear y validar per_page (clamp a opciones permitidas)
  const perPageRaw = Number(searchParams.per_page)
  const perPage = (PER_PAGE_OPCIONES as readonly number[]).includes(perPageRaw)
    ? perPageRaw
    : PER_PAGE_DEFAULT

  // Parsear y validar page (mínimo 1)
  const pageRaw = Number(searchParams.page)
  const currentPage =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1

  const [{ productos, total }, categorias] = await Promise.all([
    listarProductos({
      busqueda: filters.q,
      soloActivos: filters.estado !== 'todos',
      stockBajo: filters.stock === 'bajo',
      categoria: filters.categoria,
      orden: filters.orden as
        | 'nombre_asc'
        | 'nombre_desc'
        | 'fecha_desc'
        | 'stock_asc',
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    }),
    listarCategorias(),
  ])

  return (
    <ProductosView
      productos={productos}
      total={total}
      filters={filters}
      currentPage={currentPage}
      perPage={perPage}
      categorias={categorias}
      puedeEditar={puedeEditar}
    />
  )
}
