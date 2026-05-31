import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarMarcas, listarCategorias } from '@/lib/queries/catalogos'
import { Button } from '@/components/ui/button'
import { ProductoForm } from './_components/producto-form'

export const metadata = {
  title: 'Nuevo producto',
}

export default async function NuevoProductoPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const [marcas, categorias] = await Promise.all([
    listarMarcas(),
    listarCategorias(),
  ])

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Breadcrumb / back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/productos">
              <ArrowLeft className="size-4 mr-1" />
              Volver a productos
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Nuevo producto
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá la información del producto y sus variantes
          </p>
        </div>

        {/* Form */}
        <ProductoForm marcas={marcas} categorias={categorias} />
      </div>
    </div>
  )
}
