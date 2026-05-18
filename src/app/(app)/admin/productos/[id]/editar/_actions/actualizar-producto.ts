// src/app/(app)/admin/productos/[id]/editar/_actions/actualizar-producto.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { productoSchema, type ProductoInput } from '@/lib/validations/producto'
import { borrarImagenProducto } from '@/lib/images/upload'

export type ActualizarProductoResult =
  | { ok: true; productoId: string }
  | { ok: false; error: string; field?: string }

/**
 * Server Action: actualiza un producto existente con sus variantes.
 *
 * Estrategia de variantes:
 * - Las variantes existentes NO se eliminan (para preservar historial de ventas).
 * - Se marcan como `activa = false` las que ya no están en la lista.
 * - Se actualizan las que siguen (stock, color, talle).
 * - Se crean las nuevas.
 * - Al reactivar, se pueden volver a poner `activa = true` si matchean SKU.
 *
 * Estrategia de imagen:
 * - Si imagen_url cambió (o pasó a null), borra la vieja de Storage (best effort).
 */
export async function actualizarProducto(
  productoId: string,
  input: ProductoInput
): Promise<ActualizarProductoResult> {
  try {
    // Auth
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'No tenés permisos para modificar productos' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'Sin empresa activa' }
    }

    // Validar
    const parsed = productoSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      }
    }
    const data = parsed.data

    const supabase = await createClient()

    // Verificar que el producto existe + traer imagen vieja
    const { data: productoExistente, error: errorExistente } = await supabase
      .from('productos')
      .select('id, sku_base, imagen_url')
      .eq('id', productoId)
      .single()

    if (errorExistente || !productoExistente) {
      return { ok: false, error: 'Producto no encontrado' }
    }

    // Si cambió el SKU, verificar que el nuevo no exista
    if (data.sku_base !== productoExistente.sku_base) {
      const { data: skuDuplicado } = await supabase
        .from('productos')
        .select('id, nombre, activo')
        .eq('sku_base', data.sku_base)
        .neq('id', productoId)
        .maybeSingle()

      if (skuDuplicado) {
        return {
          ok: false,
          field: 'sku_base',
          error: skuDuplicado.activo
            ? `El SKU "${data.sku_base}" ya está en uso por "${skuDuplicado.nombre}"`
            : `El SKU "${data.sku_base}" fue usado por un producto dado de baja. Elegí otro.`,
        }
      }
    }

    // 1. Actualizar datos del producto
    const nuevaImagenUrl = data.imagen_url ?? null
    const imagenVieja = productoExistente.imagen_url

    const { error: errorUpdate } = await supabase
      .from('productos')
      .update({
        nombre: data.nombre.trim(),
        sku_base: data.sku_base,
        precio_neto: data.precio_neto,
        categoria: data.categoria?.trim() || null,
        descripcion_corta: data.descripcion_corta?.trim() || null,
        imagen_url: nuevaImagenUrl,
        track_stock: data.track_stock,
      })
      .eq('id', productoId)

    if (errorUpdate) {
      console.error('[actualizarProducto] Error update producto:', errorUpdate)
      return { ok: false, error: errorUpdate.message }
    }

    // Borrar imagen vieja si cambió (best effort)
    if (imagenVieja && imagenVieja !== nuevaImagenUrl) {
      void borrarImagenProducto(imagenVieja)
    }

    // 2. Manejo de variantes
    // Traer las variantes actuales del producto
    const { data: variantesActuales } = await supabase
      .from('variantes')
      .select('*')
      .eq('producto_id', productoId)

    const variantesExistentesMap = new Map(
      (variantesActuales ?? []).map((v) => [v.sku_variante, v])
    )

    // Construir las variantes finales (las del form)
    let variantesFinales: Array<{
      sku_variante: string
      color: string | null
      talle: string | null
      stock: number
    }> = []

    if (data.tiene_variantes && data.variantes.length > 0) {
      variantesFinales = data.variantes.map((v) => {
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
          sku_variante: skuVariante,
          color: colorTrim,
          talle: talleTrim,
          stock: v.stock,
        }
      })
    } else {
      // Sin variantes → una DEFAULT
      variantesFinales = [
        {
          sku_variante: `${data.sku_base}-DEFAULT`,
          color: null,
          talle: null,
          stock: data.track_stock ? data.stock_inicial : 0,
        },
      ]
    }

    // SKUs finales
    const skusFinales = new Set(variantesFinales.map((v) => v.sku_variante))

    // Actualizar/crear cada variante final
    for (const variante of variantesFinales) {
      const existente = variantesExistentesMap.get(variante.sku_variante)
      if (existente) {
        // Update (y reactivar si estaba inactiva)
        const { error } = await supabase
          .from('variantes')
          .update({
            color: variante.color,
            talle: variante.talle,
            stock: variante.stock,
            activa: true,
          })
          .eq('id', existente.id)
        if (error) {
          console.error('[actualizarProducto] Error update variante:', error)
          return {
            ok: false,
            error: 'Error actualizando variante: ' + error.message,
          }
        }
      } else {
        // Insert nueva variante — empresa_id requerido por multitenant
        const { error } = await supabase.from('variantes').insert({
          producto_id: productoId,
          color: variante.color,
          talle: variante.talle,
          sku_variante: variante.sku_variante,
          stock: variante.stock,
          activa: true,
          empresa_id: user.empresa_id,
        })
        if (error) {
          console.error('[actualizarProducto] Error insert variante:', error)
          return {
            ok: false,
            error: 'Error creando variante: ' + error.message,
          }
        }
      }
    }

    // Desactivar variantes que ya no están en la lista
    const variantesAEliminar = (variantesActuales ?? []).filter(
      (v) => v.sku_variante && !skusFinales.has(v.sku_variante)
    )
    for (const v of variantesAEliminar) {
      await supabase
        .from('variantes')
        .update({ activa: false })
        .eq('id', v.id)
    }

    // 3. Actualizar catálogos
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

    // 4. Revalidar
    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos/${productoId}`)

    return { ok: true, productoId }
  } catch (error) {
    console.error('[actualizarProducto] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}