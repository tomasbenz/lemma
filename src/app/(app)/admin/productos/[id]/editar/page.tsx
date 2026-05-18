import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerProducto } from '@/lib/queries/productos'
import { listarColores, listarTalles } from '@/lib/queries/catalogos'
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

export default async function EditarProductoPage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { id } = await params
  const producto = await obtenerProducto(id)
  if (!producto) notFound()

  const [colores, talles] = await Promise.all([
    listarColores(),
    listarTalles(),
  ])

  // Preparar initialData para el form
  const variantesActivas = producto.variantes.filter((v) => v.activa)
  const tieneVariantes = variantesActivas.some(
    (v) => v.color !== null || v.talle !== null
  )

  const stockInicial =
    !tieneVariantes && variantesActivas.length > 0
      ? variantesActivas[0].stock
      : 0

  const initialData = {
    id: producto.id,
    nombre: producto.nombre,
    sku_base: producto.sku_base,
    precio_neto: producto.precio_neto,
    categoria: producto.categoria ?? '',
    descripcion_corta: producto.descripcion_corta ?? '',
    track_stock: producto.track_stock,
    tiene_variantes: tieneVariantes,
    stock_inicial: stockInicial,
    variantes: tieneVariantes
      ? variantesActivas.map((v) => ({
          color: v.color ?? '',
          talle: v.talle ?? '',
          stock: v.stock,
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
          colores={colores}
          talles={talles}
          initialData={initialData}
        />
      </div>
    </div>
  )
}