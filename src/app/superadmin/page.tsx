// src/app/superadmin/page.tsx
import Link from 'next/link'
import { LogOut, Building2, Eye, EyeOff } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NuevaEmpresaDialog } from './_components/nueva-empresa-dialog'
import { EmpresaCard } from './_components/empresa-card'

export const dynamic = 'force-dynamic'

export type EmpresaConStats = {
  id: string
  nombre: string
  slug: string
  activo: boolean
  created_at: string
  eliminada_at: string | null
  total_usuarios: number
  total_ventas: number
  total_productos: number
  facturas_afip_aprobadas: number
  /**
   * ISO de la factura AFIP aprobada más reciente. Null si no hay facturas.
   * Sirve para calcular cuándo se cumplen los 10 años de conservación fiscal.
   */
  ultima_factura_afip_at: string | null
  /**
   * Fecha YYYY-MM-DD en la que la empresa queda "lista para eliminación
   * definitiva" según RG AFIP 4290 (10 años desde la última factura).
   * Null si no hay facturas AFIP.
   */
  eliminacion_definitiva_en: string | null
  /** True si la empresa está desactivada Y ya pasaron los 10 años fiscales. */
  lista_para_eliminacion: boolean
}

async function listarEmpresas(
  incluirDesactivadas: boolean
): Promise<EmpresaConStats[]> {
  const admin = createAdminClient()

  let query = admin
    .from('empresas')
    .select('id, nombre, slug, activo, created_at, eliminada_at')
    .order('activo', { ascending: false })
    .order('created_at', { ascending: true })

  if (!incluirDesactivadas) {
    query = query.eq('activo', true)
  }

  const { data: empresas, error } = await query

  if (error || !empresas) {
    console.error('[superadmin] Error listando empresas:', error)
    return []
  }

  const ahora = Date.now()

  const empresasConStats: EmpresaConStats[] = await Promise.all(
    empresas.map(async (e) => {
      const [usuariosRes, ventasRes, productosRes, facturasRes, ultimaFactura] =
        await Promise.all([
          admin
            .from('usuarios')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', e.id)
            .eq('activo', true)
            .neq('rol', 'superadmin'),
          admin
            .from('ventas')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', e.id),
          admin
            .from('productos')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', e.id)
            .eq('activo', true),
          admin
            .from('facturas_afip')
            .select('id', { count: 'exact', head: true })
            .eq('empresa_id', e.id)
            .in('estado', ['aprobada', 'aprobada_sin_persistir']),
          admin
            .from('facturas_afip')
            .select('created_at')
            .eq('empresa_id', e.id)
            .in('estado', ['aprobada', 'aprobada_sin_persistir'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

      const ultimaAt = ultimaFactura.data?.created_at ?? null
      let eliminacionEn: string | null = null
      let listaParaEliminacion = false

      if (ultimaAt) {
        const limite = new Date(ultimaAt)
        limite.setUTCFullYear(limite.getUTCFullYear() + 10)
        eliminacionEn = limite.toISOString().slice(0, 10)
        listaParaEliminacion = !e.activo && limite.getTime() <= ahora
      } else if (!e.activo) {
        // Sin facturas AFIP: lista para eliminación física inmediata
        listaParaEliminacion = true
      }

      return {
        ...e,
        total_usuarios: usuariosRes.count ?? 0,
        total_ventas: ventasRes.count ?? 0,
        total_productos: productosRes.count ?? 0,
        facturas_afip_aprobadas: facturasRes.count ?? 0,
        ultima_factura_afip_at: ultimaAt,
        eliminacion_definitiva_en: eliminacionEn,
        lista_para_eliminacion: listaParaEliminacion,
      }
    })
  )

  return empresasConStats
}

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const incluirDesactivadas = params.desactivadas === '1'

  const empresas = await listarEmpresas(incluirDesactivadas)
  const activas = empresas.filter((e) => e.activo)
  const desactivadas = empresas.filter((e) => !e.activo)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                Panel Superadmin
              </h1>
              <p className="text-xs text-muted-foreground">Loom Point</p>
            </div>
          </div>

          <form action="/api/auth/signout" method="post">
            <Button variant="ghost" size="sm" type="submit">
              <LogOut className="size-4 mr-2" />
              Cerrar sesión
            </Button>
          </form>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Empresas</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {activas.length === 0 && desactivadas.length === 0
                ? 'No hay empresas todavía. Creá la primera para empezar.'
                : `${activas.length} ${activas.length === 1 ? 'empresa activa' : 'empresas activas'}${
                    incluirDesactivadas && desactivadas.length > 0
                      ? ` · ${desactivadas.length} desactivada${desactivadas.length === 1 ? '' : 's'}`
                      : ''
                  } · seleccioná una para operar.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={
                  incluirDesactivadas ? '/superadmin' : '/superadmin?desactivadas=1'
                }
              >
                {incluirDesactivadas ? (
                  <>
                    <EyeOff className="size-4 mr-2" />
                    Ocultar desactivadas
                  </>
                ) : (
                  <>
                    <Eye className="size-4 mr-2" />
                    Mostrar desactivadas
                  </>
                )}
              </Link>
            </Button>
            <NuevaEmpresaDialog />
          </div>
        </div>

        {activas.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activas.map((empresa) => (
              <EmpresaCard key={empresa.id} empresa={empresa} />
            ))}
          </div>
        )}

        {incluirDesactivadas && desactivadas.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Desactivadas
              </h3>
              <span className="text-xs text-muted-foreground">
                ({desactivadas.length})
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {desactivadas.map((empresa) => (
                <EmpresaCard key={empresa.id} empresa={empresa} />
              ))}
            </div>
          </div>
        )}

        {empresas.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="size-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">
                {incluirDesactivadas
                  ? 'Todavía no creaste ninguna empresa.'
                  : 'No hay empresas activas.'}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
