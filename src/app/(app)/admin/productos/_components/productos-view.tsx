'use client'

import { useState, useTransition, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import Link from 'next/link'
import {
  Search,
  LayoutGrid,
  List,
  Filter,
  Package,
  Plus,
  X,
} from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/app/empty-state'
import { Paginador } from '@/components/app/paginador'
import { ProductosTabla, type Orden } from './productos-tabla'
import { ProductosCards } from './productos-cards'
import { cn } from '@/lib/utils'
import type { ProductoConVariantes } from '@/lib/queries/productos'

type Vista = 'tabla' | 'cards'

const PER_PAGE_OPCIONES = [20, 50, 100] as const

export type ProductosFilters = {
  q: string
  orden: string
  estado: string // 'activos' | 'todos'
  stock: string // '' | 'bajo'
  categoria: string // '' | nombre exacto
}

// ============ STORE EXTERNO PARA VISTA EN LOCALSTORAGE ============
// useSyncExternalStore es la forma React 19 de leer de "fuentes externas"
// (como localStorage) sin caer en el patron useEffect+setState.
function suscribirVistaStorage(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === 'productos:vista') callback()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

function leerVistaActual(): Vista {
  const saved = localStorage.getItem('productos:vista')
  return saved === 'cards' ? 'cards' : 'tabla'
}

function leerVistaServidor(): Vista {
  return 'tabla'
}

export function ProductosView({
  productos,
  total,
  filters,
  currentPage,
  perPage,
  categorias,
  puedeEditar = true,
}: {
  productos: ProductoConVariantes[]
  total: number
  filters: ProductosFilters
  currentPage: number
  perPage: number
  categorias: string[]
  puedeEditar?: boolean
}) {
  // ============ VISTA (sincronizada con localStorage) ============
  const vista = useSyncExternalStore(
    suscribirVistaStorage,
    leerVistaActual,
    leerVistaServidor,
  )

  const cambiarVista = (nuevaVista: Vista) => {
    localStorage.setItem('productos:vista', nuevaVista)
    // Forzar notificacion a otros listeners en la misma tab
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'productos:vista',
        newValue: nuevaVista,
      }),
    )
  }

  // ============ NAVEGACION CLIENT-SIDE ============
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  /**
   * Actualiza un filtro y resetea la paginación a página 1.
   * Cualquier cambio de filtro/búsqueda/orden invalida la página actual.
   */
  const updateFilter = (key: string, value: string | null) => {
    const url = new URL(window.location.href)
    if (value === null || value === '') {
      url.searchParams.delete(key)
    } else {
      url.searchParams.set(key, value)
    }
    // Reset paginación al cambiar filtros
    url.searchParams.delete('page')

    const nuevaRuta = `${url.pathname}${url.search}`
    startTransition(() => {
      router.replace(nuevaRuta, { scroll: false })
    })
  }

  /**
   * Cambia de página. Mantiene los demás filtros intactos.
   */
  const cambiarPagina = (nuevaPagina: number) => {
    const url = new URL(window.location.href)
    if (nuevaPagina <= 1) {
      url.searchParams.delete('page')
    } else {
      url.searchParams.set('page', String(nuevaPagina))
    }

    const nuevaRuta = `${url.pathname}${url.search}`
    startTransition(() => {
      router.replace(nuevaRuta, { scroll: false })
      // Scroll al top para que el cambio de página sea visible
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  /**
   * Cambia el page size y resetea a página 1.
   */
  const cambiarPerPage = (nuevoPerPage: number) => {
    const url = new URL(window.location.href)
    url.searchParams.set('per_page', String(nuevoPerPage))
    url.searchParams.delete('page')

    const nuevaRuta = `${url.pathname}${url.search}`
    startTransition(() => {
      router.replace(nuevaRuta, { scroll: false })
    })
  }

  // ============ BUSQUEDA CON DEBOUNCE ============
  const [busquedaLocal, setBusquedaLocal] = useState(filters.q)

  const actualizarBusqueda = useDebouncedCallback((valor: string) => {
    updateFilter('q', valor || null)
  }, 400)

  const onChangeBusqueda = (valor: string) => {
    setBusquedaLocal(valor)
    actualizarBusqueda(valor)
  }

  // ============ FILTROS ============
  const mostrarSoloActivos = filters.estado !== 'todos'
  const stockBajo = filters.stock === 'bajo'
  const ordenActual = filters.orden || 'nombre_asc'

  const toggleEstado = () => {
    updateFilter('estado', mostrarSoloActivos ? 'todos' : null)
  }

  const toggleStockBajo = () => {
    updateFilter('stock', stockBajo ? null : 'bajo')
  }

  const cambiarOrden = (nuevo: string) => {
    updateFilter('orden', nuevo)
  }

  // ============ PAGINACIÓN ============
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const inicio = total === 0 ? 0 : (currentPage - 1) * perPage + 1
  const fin = Math.min(currentPage * perPage, total)

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity',
        isPending && 'opacity-60 pointer-events-none',
      )}
    >
      {/* ============ BARRA DE FILTROS ============ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Busqueda */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={busquedaLocal}
            onChange={(e) => onChangeBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filtros */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="size-4" />
              Filtros
              {(mostrarSoloActivos === false || stockBajo) && (
                <span className="ml-1 size-2 rounded-full bg-primary" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Estado</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={!mostrarSoloActivos}
              onCheckedChange={toggleEstado}
            >
              Incluir inactivos
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Stock</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={stockBajo}
              onCheckedChange={toggleStockBajo}
            >
              Solo stock bajo (&lt; 5)
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Filtro por categoría */}
        {categorias.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                {filters.categoria || 'Todas las categorías'}
                {filters.categoria && (
                  <span className="ml-1 size-2 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 max-h-96 overflow-y-auto"
            >
              <DropdownMenuLabel>Categoría</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filters.categoria}
                onValueChange={(v) => updateFilter('categoria', v || null)}
              >
                <DropdownMenuRadioItem value="">
                  Todas las categorías
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {categorias.map((c) => (
                  <DropdownMenuRadioItem key={c} value={c}>
                    {c}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Selector page size */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              {perPage} / página
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuRadioGroup
              value={String(perPage)}
              onValueChange={(v) => cambiarPerPage(Number(v))}
            >
              {PER_PAGE_OPCIONES.map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)}>
                  {n} / página
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Toggle vista (solo desktop) */}
        <div
          className="hidden sm:inline-flex items-center rounded-md border bg-background p-0.5"
          role="group"
          aria-label="Cambiar vista"
        >
          <button
            type="button"
            onClick={() => cambiarVista('tabla')}
            aria-pressed={vista === 'tabla'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium',
              vista === 'tabla'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <List className="size-4" />
            Tabla
          </button>
          <button
            type="button"
            onClick={() => cambiarVista('cards')}
            aria-pressed={vista === 'cards'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium',
              vista === 'cards'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid className="size-4" />
            Cards
          </button>
        </div>
      </div>

      {/* ============ VISTA ============ */}
      {productos.length === 0 ? (
        busquedaLocal || stockBajo || !mostrarSoloActivos ? (
          <EmptyState
            icon={<Package />}
            title="No se encontraron productos"
            description="Proba cambiar los filtros o limpiar la busqueda."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setBusquedaLocal('')
                  startTransition(() => {
                    router.replace('/admin/productos', { scroll: false })
                  })
                }}
              >
                <X className="size-4 mr-1.5" />
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title="Todavia no hay productos cargados"
            description={
              puedeEditar
                ? 'Empeza creando el primer producto de tu catalogo.'
                : 'Pedile a un admin que cargue el primer producto.'
            }
            action={
              puedeEditar ? (
                <Button asChild>
                  <Link href="/admin/productos/nuevo">
                    <Plus className="size-4 mr-1.5" />
                    Crear primer producto
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : vista === 'tabla' ? (
        <>
          {/* Desktop: tabla | Mobile: siempre cards */}
          <div className="hidden sm:block">
            <ProductosTabla
              productos={productos}
              orden={ordenActual as Orden}
              onOrdenChange={cambiarOrden}
              puedeEditar={puedeEditar}
            />
          </div>
          <div className="sm:hidden">
            <ProductosCards productos={productos} puedeEditar={puedeEditar} />
          </div>
        </>
      ) : (
        <ProductosCards productos={productos} puedeEditar={puedeEditar} />
      )}

      {/* ============ FOOTER: TOTALES + PAGINADOR ============ */}
      {total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
          <p className="text-xs text-muted-foreground font-numeric">
            Mostrando {inicio}-{fin} de {total}{' '}
            {total === 1 ? 'producto' : 'productos'}
          </p>

          <Paginador
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={cambiarPagina}
          />
        </div>
      )}
    </div>
  )
}
