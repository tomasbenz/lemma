import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { listarMarcas, listarCategoriasReales } from '@/lib/queries/productos'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { AumentoView, type ConteoCategoria } from './_components/aumento-view'

export const metadata = {
  title: 'Aumentos',
}

const PAGE_SIZE = 1000

/**
 * Construye, por categoría, los conteos y sumas de precio (total + por marca)
 * de los productos ACTIVOS de la empresa. Permite que la tabla calcule el
 * promedio y el estimado al vuelo en el cliente, scopeado por marca, sin más
 * round-trips. El preview/apply re-validan en el server.
 */
async function cargarConteos(empresaId: string): Promise<ConteoCategoria[]> {
  const supabase = await createClient()
  const acc = new Map<
    string,
    { total: number; suma: number; porMarca: Map<string, { n: number; suma: number }> }
  >()

  for (let desde = 0; ; desde += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('productos')
      .select('categoria_id, marca_id, precio_neto')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .not('categoria_id', 'is', null)
      .range(desde, desde + PAGE_SIZE - 1)

    if (error) {
      console.error('[aumentos/cargarConteos]', error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const catId = row.categoria_id as string | null
      if (!catId) continue
      const precio = (row.precio_neto as number) ?? 0
      const marcaId = (row.marca_id as string | null) ?? null

      let c = acc.get(catId)
      if (!c) {
        c = { total: 0, suma: 0, porMarca: new Map() }
        acc.set(catId, c)
      }
      c.total += 1
      c.suma += precio
      if (marcaId) {
        const m = c.porMarca.get(marcaId) ?? { n: 0, suma: 0 }
        m.n += 1
        m.suma += precio
        c.porMarca.set(marcaId, m)
      }
    }
    if (data.length < PAGE_SIZE) break
  }

  return [...acc.entries()].map(([categoria_id, c]) => ({
    categoria_id,
    total: c.total,
    suma: c.suma,
    porMarca: Object.fromEntries(c.porMarca),
  }))
}

export default async function AumentosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // Solo admin/superadmin (igual que el resto del panel admin).
  if (!puedeEditarCatalogo(user.rol)) redirect('/caja')
  if (!user.empresa_id) redirect('/admin/productos')

  const [marcas, categorias, conteos] = await Promise.all([
    listarMarcas(),
    listarCategoriasReales(),
    cargarConteos(user.empresa_id),
  ])

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
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
              Aumentá precios con un porcentaje distinto por categoría,
              opcionalmente acotado por marca.
            </p>
          </div>
        </div>

        <AumentoView
          marcas={marcas}
          categorias={categorias}
          conteos={conteos}
        />
      </div>
    </div>
  )
}
