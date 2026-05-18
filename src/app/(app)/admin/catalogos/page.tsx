// src/app/(app)/admin/catalogos/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  listarColoresAdmin,
  listarTallesAdmin,
  listarCategoriasAdmin,
} from '@/lib/queries/catalogos'
import { CatalogosView } from './_components/catalogos-view'

export const metadata = {
  title: 'Catálogos',
}

export default async function CatalogosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const [colores, talles, categorias] = await Promise.all([
    listarColoresAdmin(),
    listarTallesAdmin(),
    listarCategoriasAdmin(),
  ])

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Catálogos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Categorías, talles y colores disponibles al crear productos
          </p>
        </div>

        <CatalogosView
          colores={colores}
          talles={talles}
          categorias={categorias}
        />
      </div>
    </div>
  )
}