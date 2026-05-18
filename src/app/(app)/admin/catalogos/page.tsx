// src/app/(app)/admin/catalogos/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarCategoriasAdmin } from '@/lib/queries/catalogos'
import { CatalogosView } from './_components/catalogos-view'

export const metadata = {
  title: 'Catálogos',
}

export default async function CatalogosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const categorias = await listarCategoriasAdmin()

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Catálogos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Categorías disponibles al crear productos. Los atributos de
            variante por categoría (color, formato, gramaje, etc.) se
            configuran vía base de datos por ahora.
          </p>
        </div>

        <CatalogosView categorias={categorias} />
      </div>
    </div>
  )
}
