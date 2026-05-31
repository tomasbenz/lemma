import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerProducto } from '@/lib/queries/productos'
import { listarMarcas, listarCategorias } from '@/lib/queries/catalogos'
import { Button } from '@/components/ui/button'
import { ProductoForm } from '../../nuevo/_components/producto-form'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const producto = await obtenerProducto(id)
  return {
    title: producto ? `Editar: ${producto.nombre}` : 'Producto no encontrado',
  }
}

/**
 * Convierte el jsonb `atributos` de una variante en el array
 * [{clave, valor}] que espera el form. Filtra entradas con valores
 * vacíos o nulos para que no se rendericen como filas inválidas.
 */
function atributosAPares(
  atributos: unknown,
): Array<{ clave: string; valor: string }> {
  if (!atributos || typeof atributos !== 'object' || Array.isArray(atributos)) {
    return []
  }
  return Object.entries(atributos as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([clave, valor]) => ({ clave, valor: String(valor) }))
}

export default async function EditarProductoPage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { id } = await params
  const [producto, marcas, categorias] = await Promise.all([
    obtenerProducto(id),
    listarMarcas(),
    listarCategorias(),
  ])
  if (!producto) notFound()

  // Preparar initialData para el form
  const variantesActivas = producto.variantes.filter((v) => v.activa)
  // Una variante "real" es la que tiene atributos no vacíos. Si la única
  // variante activa es DEFAULT (sin atributos), el producto se muestra sin
  // variantes y solo se edita el stock_inicial.
  const tieneVariantes = variantesActivas.some((v) => {
    const a = v.atributos as unknown
    return (
      a !== null &&
      typeof a === 'object' &&
      !Array.isArray(a) &&
      Object.keys(a as Record<string, unknown>).length > 0
    )
  })

  const stockInicial =
    !tieneVariantes && variantesActivas.length > 0
      ? variantesActivas[0].stock
      : 0

  // Para productos sin variantes (variante DEFAULT), el código de barras
  // vive en esa única variante. Lo subimos al nivel del form porque el
  // schema lo expone como campo del producto.
  const codigoBarrasInicial =
    !tieneVariantes && variantesActivas.length > 0
      ? variantesActivas[0].codigo_barras ?? ''
      : ''

  const initialData = {
    id: producto.id,
    nombre: producto.nombre,
    sku_base: producto.sku_base,
    precio_neto: producto.precio_neto,
    costo: producto.costo ?? null,
    marca_id: producto.marca_id ?? '',
    categoria_id: producto.categoria_id ?? '',
    descripcion_corta: producto.descripcion_corta ?? '',
    codigo_barras: codigoBarrasInicial,
    // Sin esto, el form arranca con imagen_url undefined y al guardar persiste
    // null en la DB + dispara borrarImagenProducto sobre la imagen vieja,
    // eliminando la foto en cualquier edición. Preservarla acá es lo único
    // necesario: si el usuario la quita explícitamente desde el upload, el
    // form la pasa a null y ahí sí corresponde borrar.
    imagen_url: producto.imagen_url ?? null,
    track_stock: producto.track_stock,
    tiene_variantes: tieneVariantes,
    stock_inicial: stockInicial,
    variantes: tieneVariantes
      ? variantesActivas.map((v) => ({
          varianteId: v.id,
          atributos: atributosAPares(v.atributos),
          stock: v.stock,
          codigo_barras: v.codigo_barras ?? '',
        }))
      : [],
  }

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={`/admin/productos/${producto.id}`}>
              <ArrowLeft className="size-4 mr-1" />
              Volver al producto
            </Link>
          </Button>
        </div>

        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Editar producto
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Modificá los datos de{' '}
            <span className="text-foreground font-medium">
              {producto.nombre}
            </span>
          </p>
        </div>

        <ProductoForm
          initialData={initialData}
          marcas={marcas}
          categorias={categorias}
        />
      </div>
    </div>
  )
}
