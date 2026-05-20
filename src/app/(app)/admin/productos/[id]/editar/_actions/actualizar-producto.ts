// src/app/(app)/admin/productos/[id]/editar/_actions/actualizar-producto.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { productoSchema, type ProductoInput } from '@/lib/validations/producto'
import { borrarImagenProducto } from '@/lib/images/upload'
import { sufijoSku, type Atributos } from '@/lib/format-atributos'
import { normalizarCodigoBarras } from '@/lib/codigo-barras/validar'

export type ActualizarProductoResult =
  | { ok: true; productoId: string }
  | { ok: false; error: string; field?: string }

function pairsAObjeto(
  pares: Array<{ clave: string; valor: string }>,
): Atributos {
  const out: Atributos = {}
  for (const p of pares) {
    const k = p.clave.trim().toLowerCase()
    const v = p.valor.trim()
    if (k && v) out[k] = v
  }
  return out
}

/**
 * Server Action: actualiza un producto existente con sus variantes.
 *
 * Estrategia de variantes:
 * - Las variantes existentes NO se eliminan (para preservar historial de ventas).
 * - Se marcan como `activa = false` las que ya no están en la lista.
 * - Se actualizan las que siguen (stock, atributos).
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
    const { data: variantesActuales } = await supabase
      .from('variantes')
      .select('*')
      .eq('producto_id', productoId)

    const variantesExistentesMap = new Map(
      (variantesActuales ?? []).map((v) => [v.sku_variante, v])
    )

    type VarianteFinal = {
      sku_variante: string
      atributos: Atributos
      stock: number
      // undefined → no tocar la columna codigo_barras (camino con variantes,
      // que se entrega aparte). null/string → setear el valor en DEFAULT.
      codigo_barras?: string | null
    }

    let variantesFinales: VarianteFinal[] = []

    if (data.tiene_variantes && data.variantes.length > 0) {
      variantesFinales = data.variantes.map((v) => {
        const atributos = pairsAObjeto(v.atributos ?? [])
        const sufijo = sufijoSku(atributos)
        return {
          sku_variante: `${data.sku_base}-${sufijo}`,
          atributos,
          stock: v.stock,
        }
      })
    } else {
      // Sin variantes → una DEFAULT. Acá sí seteamos codigo_barras explícitamente
      // (null si el campo vino vacío, normalizado si vino con valor).
      const codigoBarras = data.codigo_barras
        ? normalizarCodigoBarras(data.codigo_barras)
        : null
      variantesFinales = [
        {
          sku_variante: `${data.sku_base}-DEFAULT`,
          atributos: {},
          stock: data.track_stock ? data.stock_inicial : 0,
          codigo_barras: codigoBarras,
        },
      ]
    }

    // SKUs finales
    const skusFinales = new Set(variantesFinales.map((v) => v.sku_variante))

    // Actualizar/crear cada variante final
    for (const variante of variantesFinales) {
      const existente = variantesExistentesMap.get(variante.sku_variante)
      // Solo incluimos codigo_barras en el payload cuando el camino DEFAULT
      // explicitamente lo seteó. En el camino con variantes queda undefined
      // y no toca la columna existente.
      const codigoBarrasPatch =
        variante.codigo_barras !== undefined
          ? { codigo_barras: variante.codigo_barras }
          : {}

      if (existente) {
        const { error } = await supabase
          .from('variantes')
          .update({
            atributos: variante.atributos,
            stock: variante.stock,
            activa: true,
            ...codigoBarrasPatch,
          })
          .eq('id', existente.id)
        if (error) {
          console.error('[actualizarProducto] Error update variante:', error)
          const esCodigoDuplicado =
            error.code === '23505' &&
            (error.message?.includes('codigo_barras') ?? false)
          if (esCodigoDuplicado) {
            return {
              ok: false,
              field: 'codigo_barras',
              error: 'Ese código de barras ya está asignado a otro producto.',
            }
          }
          return {
            ok: false,
            error: 'Error actualizando variante: ' + error.message,
          }
        }
      } else {
        const { error } = await supabase.from('variantes').insert({
          producto_id: productoId,
          atributos: variante.atributos,
          sku_variante: variante.sku_variante,
          stock: variante.stock,
          activa: true,
          empresa_id: user.empresa_id,
          ...codigoBarrasPatch,
        })
        if (error) {
          console.error('[actualizarProducto] Error insert variante:', error)
          const esCodigoDuplicado =
            error.code === '23505' &&
            (error.message?.includes('codigo_barras') ?? false)
          if (esCodigoDuplicado) {
            return {
              ok: false,
              field: 'codigo_barras',
              error: 'Ese código de barras ya está asignado a otro producto.',
            }
          }
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

    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos/${productoId}`)

    return { ok: true, productoId }
  } catch (error) {
    console.error('[actualizarProducto] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
