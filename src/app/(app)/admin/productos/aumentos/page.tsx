import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { listarMarcas, listarCategoriasReales } from '@/lib/queries/productos'
import { Button } from '@/components/ui/button'
import { AumentoWorkspace } from './_components/aumento-workspace'

export const metadata = {
  title: 'Aumentos',
}

export default async function AumentosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // Solo admin/superadmin (igual que el resto del panel admin de catálogo).
  if (!puedeEditarCatalogo(user.rol)) redirect('/caja')

  const [marcas, categorias] = await Promise.all([
    listarMarcas(),
    listarCategoriasReales(),
  ])

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-fit -ml-2 text-muted-foreground"
          >
            <Link href="/admin/productos">
              <ArrowLeft className="size-4 mr-1.5" />
              Productos
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Aumentos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Filtrá por marca y/o categoría, seleccioná productos y aplicá un
              cambio de precio. Cada operación queda registrada con su motivo.
            </p>
          </div>
        </div>

        <AumentoWorkspace marcas={marcas} categorias={categorias} />
      </div>
    </div>
  )
}
