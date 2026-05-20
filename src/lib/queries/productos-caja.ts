import { createClient } from '@/lib/supabase/server'
import type { Atributos } from '@/lib/format-atributos'
import type { Database } from '@/types/database'

type ProductoRow = Database['public']['Tables']['productos']['Row']

export type VarianteCaja = {
  id: string
  /**
   * Atributos genéricos de la variante (color, tamaño, gramaje, formato, etc.).
   * Generaliza el viejo par (color, talle) del proyecto Loom Point a un jsonb
   * arbitrario para que la misma tabla `variantes` sirva a distintos rubros.
   * Default {} para productos sin variantes (la variante DEFAULT del producto).
   */
  atributos: Atributos
  sku_variante: string
  stock: number
  codigo_barras: string | null
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
 * - Sin paginación (max 500, suficiente para 100-200 productos típicos)
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
      variantes(id, atributos, sku_variante, stock, activa, codigo_barras)
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
        // Supabase devuelve jsonb como Json (record/null). Lo coercemos a
        // Record<string,string>: la app inserta siempre objetos planos de
        // string→string, así que esta coerción es segura en runtime.
        atributos:
          v.atributos && typeof v.atributos === 'object' && !Array.isArray(v.atributos)
            ? (v.atributos as Atributos)
            : {},
        sku_variante: v.sku_variante as string,
        stock: v.stock ?? 0,
        codigo_barras: v.codigo_barras ?? null,
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
