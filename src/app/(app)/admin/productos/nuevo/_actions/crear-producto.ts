// src/app/(app)/admin/productos/nuevo/_actions/crear-producto.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { productoSchema, type ProductoInput } from '@/lib/validations/producto'
import { borrarImagenProducto } from '@/lib/images/upload'

export type CrearProductoResult =
  | { ok: true; productoId: string; slug: string }
  | { ok: false; error: string; field?: string }

/**
 * Server Action: crea un producto con sus variantes en una transacción lógica.
 *
 * Flujo:
 * 1. Verifica auth (solo admin/superadmin pueden crear)
 * 2. Valida datos con Zod
 * 3. Verifica que el SKU base no exista (incluso en productos inactivos)
 * 4. Inserta producto (incluyendo imagen_url si vino)
 * 5. Inserta variantes (si tiene) o crea variante DEFAULT (si no)
 * 6. Revalida el listado
 * 7. Devuelve el ID para redireccionar
 */
export async function crearProducto(
  input: ProductoInput
): Promise<CrearProductoResult> {
  try {
    // 1. Auth
    const user = await getCurrentUser()
    if (!user) {
      return { ok: false, error: 'No autenticado' }
    }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'No tenés permisos para crear productos' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'Sin empresa activa' }
    }

    // 2. Validar
    const parsed = productoSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      }
    }
    const data = parsed.data

    const supabase = await createClient()

    // 3. Verificar SKU único (incluyendo productos inactivos)
    const { data: existente } = await supabase
      .from('productos')
      .select('id, nombre, activo')
      .eq('sku_base', data.sku_base)
      .maybeSingle()

    if (existente) {
      if (data.imagen_url) {
        void borrarImagenProducto(data.imagen_url)
      }
      return {
        ok: false,
        field: 'sku_base',
        error: existente.activo
          ? `El SKU "${data.sku_base}" ya está en uso por "${existente.nombre}"`
          : `El SKU "${data.sku_base}" fue usado por un producto dado de baja. Elegí otro.`,
      }
    }

    // 4. Insertar producto — empresa_id requerido por multitenant
    const { data: producto, error: errorProducto } = await supabase
      .from('productos')
      .insert({
        nombre: data.nombre.trim(),
        sku_base: data.sku_base,
        precio_neto: data.precio_neto,
        categoria: data.categoria?.trim() || null,
        descripcion_corta: data.descripcion_corta?.trim() || null,
        imagen_url: data.imagen_url ?? null,
        track_stock: data.track_stock,
        activo: true,
        empresa_id: user.empresa_id,
      })
      .select()
      .single()

    if (errorProducto || !producto) {
      console.error('[crearProducto] Error insertando producto:', errorProducto)
      if (data.imagen_url) {
        void borrarImagenProducto(data.imagen_url)
      }
      return {
        ok: false,
        error: errorProducto?.message ?? 'Error al guardar el producto',
      }
    }

    // 5. Insertar variantes — empresa_id requerido por multitenant
    let variantesParaInsertar: Array<{
      producto_id: string
      color: string | null
      talle: string | null
      sku_variante: string
      stock: number
      activa: boolean
      empresa_id: string
    }> = []

    if (data.tiene_variantes && data.variantes.length > 0) {
      variantesParaInsertar = data.variantes.map((v) => {
        const colorTrim = v.color?.trim() || null
        const talleTrim = v.talle?.trim() || null
        const sufijos = [colorTrim, talleTrim]
          .filter(Boolean)
          .map((s) => s!.toUpperCase().replace(/\s+/g, '-'))
        const skuVariante =
          sufijos.length > 0
            ? `${data.sku_base}-${sufijos.join('-')}`
            : `${data.sku_base}-DEFAULT`

        return {
          producto_id: producto.id,
          color: colorTrim,
          talle: talleTrim,
          sku_variante: skuVariante,
          stock: v.stock,
          activa: true,
          empresa_id: user.empresa_id!,
        }
      })
    } else {
      // No tiene variantes → crear una DEFAULT
      variantesParaInsertar = [
        {
          producto_id: producto.id,
          color: null,
          talle: null,
          sku_variante: `${data.sku_base}-DEFAULT`,
          stock: data.track_stock ? data.stock_inicial : 0,
          activa: true,
          empresa_id: user.empresa_id,
        },
      ]
    }

    const { error: errorVariantes } = await supabase
      .from('variantes')
      .insert(variantesParaInsertar)

    if (errorVariantes) {
      console.error('[crearProducto] Error insertando variantes:', errorVariantes)
      await supabase.from('productos').delete().eq('id', producto.id)
      if (data.imagen_url) {
        void borrarImagenProducto(data.imagen_url)
      }
      return {
        ok: false,
        error:
          'Error al guardar variantes. El producto no se creó: ' +
          errorVariantes.message,
      }
    }

    // 6. Si tiene variantes con color/talle nuevos, agregarlos al catálogo
    if (data.tiene_variantes) {
      for (const variante of data.variantes) {
        if (variante.color?.trim()) {
          await supabase.rpc('buscar_o_crear_color', {
            p_nombre: variante.color.trim(),
          })
        }
        if (variante.talle?.trim()) {
          await supabase.rpc('buscar_o_crear_talle', {
            p_nombre: variante.talle.trim(),
          })
        }
      }
    }

    // 7. Revalidar el listado
    revalidatePath('/admin/productos')

    return {
      ok: true,
      productoId: producto.id,
      slug: producto.sku_base,
    }
  } catch (error) {
    console.error('[crearProducto] Error inesperado:', error)
    return {
      ok: false,
      error: 'Error inesperado. Intentá de nuevo.',
    }
  }
}

/**
 * Helper: verifica si un SKU base ya existe.
 * Se llama desde el form en tiempo real para avisar al usuario.
 */
export async function verificarSkuDisponible(
  sku: string
): Promise<{ disponible: boolean; mensaje?: string }> {
  if (!sku || sku.length < 2) {
    return { disponible: true }
  }

  try {
    const user = await getCurrentUser()
    if (!user) {
      return { disponible: true }
    }

    const supabase = await createClient()
    const { data } = await supabase
      .from('productos')
      .select('nombre, activo')
      .eq('sku_base', sku.toUpperCase().trim())
      .maybeSingle()

    if (!data) {
      return { disponible: true }
    }

    return {
      disponible: false,
      mensaje: data.activo
        ? `Ya está en uso por "${data.nombre}"`
        : `Fue usado por un producto dado de baja`,
    }
  } catch {
    return { disponible: true }
  }
}

/**
 * Helper: auto-genera un SKU sugerido basado en la categoría.
 */
export async function sugerirSkuBase(
  categoria: string
): Promise<string | null> {
  if (!categoria || categoria.trim().length < 3) {
    return null
  }

  try {
    const user = await getCurrentUser()
    if (!user) return null

    const prefijo = categoria
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3)

    if (prefijo.length < 3) {
      return null
    }

    const supabase = await createClient()
    const { data } = await supabase
      .from('productos')
      .select('sku_base')
      .like('sku_base', `${prefijo}-%`)
      .order('sku_base', { ascending: false })
      .limit(1)

    let siguiente = 1
    if (data && data.length > 0) {
      const match = data[0].sku_base.match(new RegExp(`^${prefijo}-(\\d+)`))
      if (match) {
        siguiente = parseInt(match[1], 10) + 1
      }
    }

    return `${prefijo}-${String(siguiente).padStart(3, '0')}`
  } catch (error) {
    console.error('[sugerirSkuBase] Error:', error)
    return null
  }
}