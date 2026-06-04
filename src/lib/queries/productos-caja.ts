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
  'id' | 'nombre' | 'sku_base' | 'precio_neto' | 'imagen_url' | 'track_stock'
> & {
  /** Nombre de la marca (vía JOIN). Reemplaza el viejo `categoria` text. */
  marca_nombre: string | null
  /** Nombre de la categoría real (vía JOIN). null hasta que Samu la asigne. */
  categoria_nombre: string | null
  variantes: VarianteCaja[]
  stock_total: number
}

// PostgREST capea en 1000 filas por request, así que el catálogo completo
// se trae paginando con .range() en loop hasta que un lote venga incompleto.
// Un .limit(N) hardcoded acá truncaba el catálogo (bug histórico: limit(500)
// dejaba afuera la mitad alfabética inferior con catálogos grandes).
const PAGE_SIZE = 1000

/**
 * Lista productos para la pantalla de caja.
 * - Solo productos activos
 * - Solo variantes activas
 * - Ordenados alfabéticamente
 * - Paginado con range() en loop: trae TODO el catálogo activo
 */
export async function listarProductosCaja(): Promise<ProductoCaja[]> {
  const supabase = await createClient()

  type Fila = {
    id: string
    nombre: string
    sku_base: string
    precio_neto: number
    imagen_url: string | null
    track_stock: boolean
    marca: unknown
    categoria: unknown
    variantes: {
      id: string
      atributos: unknown
      sku_variante: string | null
      stock: number | null
      activa: boolean
      codigo_barras: string | null
    }[] | null
  }

  const filas: Fila[] = []
  let offset = 0
  let lote: Fila[] = []

  do {
    const { data, error } = await supabase
      .from('productos')
      .select(
        `
        id,
        nombre,
        sku_base,
        precio_neto,
        imagen_url,
        track_stock,
        marca:marcas(nombre),
        categoria:catalogo_categorias(nombre),
        variantes(id, atributos, sku_variante, stock, activa, codigo_barras)
      `
      )
      .eq('activo', true)
      .order('nombre', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('[listarProductosCaja] Error página:', {
        offset,
        message: error.message,
        code: error.code,
      })
      throw new Error('Error al cargar productos')
    }

    lote = (data ?? []) as Fila[]
    filas.push(...lote)
    offset += PAGE_SIZE
  } while (lote.length === PAGE_SIZE) // lote lleno → puede haber más

  const productos: ProductoCaja[] = filas.map((p) => {
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

    // Embeds to-one: supabase puede tiparlos como objeto o como array de 1.
    const nombreEmbed = (raw: unknown): string | null => {
      const obj = Array.isArray(raw) ? raw[0] ?? null : raw
      return obj && typeof obj === 'object' && 'nombre' in obj
        ? ((obj as { nombre: string }).nombre ?? null)
        : null
    }

    return {
      id: p.id,
      nombre: p.nombre,
      sku_base: p.sku_base,
      precio_neto: p.precio_neto,
      marca_nombre: nombreEmbed(p.marca),
      categoria_nombre: nombreEmbed(p.categoria),
      imagen_url: p.imagen_url,
      track_stock: p.track_stock,
      variantes: variantesActivas,
      stock_total,
    }
  })

  return productos
}
