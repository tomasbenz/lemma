import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type ProductoRow = Database['public']['Tables']['productos']['Row']

export type VarianteCaja = {
  id: string
  color: string | null
  talle: string | null
  sku_variante: string
  stock: number
}

export type ProductoCaja = Pick<
  ProductoRow,
  'id' | 'nombre' | 'sku_base' | 'precio_neto' | 'categoria' | 'imagen_url' | 'track_stock'
> & {
  variantes: VarianteCaja[]
  stock_total: number
}

/**
 * Lista productos para la pantalla de caja.
 * - Solo productos activos
 * - Solo variantes activas
 * - Ordenados alfabéticamente
 * - Sin paginación (max 500, para un catálogo de 100-200 es de sobra)
 */
export async function listarProductosCaja(): Promise<ProductoCaja[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('productos')
    .select(
      `
      id,
      nombre,
      sku_base,
      precio_neto,
      categoria,
      imagen_url,
      track_stock,
      variantes(id, color, talle, sku_variante, stock, activa)
    `
    )
    .eq('activo', true)
    .order('nombre', { ascending: true })
    .limit(500)

  if (error) {
    console.error('[listarProductosCaja] Error:', error.message)
    throw new Error('Error al cargar productos')
  }

  const productos: ProductoCaja[] = (data ?? []).map((p) => {
    const variantesActivas: VarianteCaja[] = (p.variantes ?? [])
      .filter((v) => v.activa && v.sku_variante !== null)
      .map((v) => ({
        id: v.id,
        color: v.color,
        talle: v.talle,
        sku_variante: v.sku_variante as string,
        stock: v.stock ?? 0,
      }))

    const stock_total = variantesActivas.reduce((sum, v) => sum + v.stock, 0)

    return {
      id: p.id,
      nombre: p.nombre,
      sku_base: p.sku_base,
      precio_neto: p.precio_neto,
      categoria: p.categoria,
      imagen_url: p.imagen_url,
      track_stock: p.track_stock,
      variantes: variantesActivas,
      stock_total,
    }
  })

  return productos
}