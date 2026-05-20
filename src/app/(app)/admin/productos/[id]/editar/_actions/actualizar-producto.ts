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
    //
    // Tracking por id (no por sku_variante):
    // el sku_variante se deriva de los atributos (${sku_base}-${sufijo}), así
    // que editar un atributo cambia el sku y un matching por sku trataría a
    // la misma variante como "se fue, llegó una nueva", perdiendo id, stock
    // e historial de ventas. Trackeamos por id estable.
    //
    // El form arrastra el id de cada variante existente vía un hidden input
    // (camino CON variantes). Para la DEFAULT (camino SIN variantes) el form
    // no carga el id; ahí caemos a matching por sku porque
    // `${sku_base}-DEFAULT` es estable mientras el sku_base no cambie.
    const { data: variantesActuales } = await supabase
      .from('variantes')
      .select('*')
      .eq('producto_id', productoId)

    const existentesPorId = new Map(
      (variantesActuales ?? []).map((v) => [v.id, v] as const)
    )

    type VarianteFinal = {
      // id de la variante en la DB cuando viene del form (existente). Se llama
      // `varianteId` (no `id`) porque arrastra el nombre que usa el schema/form
      // para no chocar con el `id` interno de useFieldArray. No confundir con
      // el `id` real de la fila en la tabla `variantes` (ese sigue siendo `id`
      // en `variantesActuales` y en el Map `existentesPorId`).
      varianteId?: string
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
          varianteId: v.varianteId,
          sku_variante: `${data.sku_base}-${sufijo}`,
          atributos,
          stock: v.stock,
          // El form siempre provee este campo (string vacío → null). Al estar
          // definido (string o null, nunca undefined), el codigoBarrasPatch de
          // más abajo lo incluye en el UPDATE/INSERT y persiste el cambio,
          // incluyendo el caso "borrar el código de barras" (null).
          codigo_barras: v.codigo_barras
            ? normalizarCodigoBarras(v.codigo_barras)
            : null,
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

    // Parear cada variante final con una existente (si la hay).
    // Prioridad: 1) match por id estable, 2) fallback por sku (DEFAULT y casos
    // heredados sin id). `idsConsumidos` evita parear dos finales al mismo
    // existente cuando ambos caminos podrían coincidir.
    type Pareo = { final: VarianteFinal; existenteId: string | null }
    const pareos: Pareo[] = []
    const idsConsumidos = new Set<string>()

    for (const final of variantesFinales) {
      let existenteId: string | null = null
      if (
        final.varianteId &&
        existentesPorId.has(final.varianteId) &&
        !idsConsumidos.has(final.varianteId)
      ) {
        existenteId = final.varianteId
      } else {
        const porSku = (variantesActuales ?? []).find(
          (v) =>
            v.sku_variante === final.sku_variante && !idsConsumidos.has(v.id)
        )
        if (porSku) existenteId = porSku.id
      }
      if (existenteId) idsConsumidos.add(existenteId)
      pareos.push({ final, existenteId })
    }

    // Variantes existentes que quedan sin pareo → desactivar.
    const idsADesactivar: string[] = []
    for (const v of variantesActuales ?? []) {
      if (!idsConsumidos.has(v.id)) idsADesactivar.push(v.id)
    }

    // FASE 1: liberar sku_variante de las filas que van a cambiar de sku o
    // que se van a desactivar. El índice UNIQUE parcial
    // variantes_sku_unq ON variantes(sku_variante) WHERE sku_variante IS NOT NULL
    // ignora los NULL, así que poner NULL libera el valor anterior y previene
    // colisiones en FASE 2 (ej. swap de atributos entre dos variantes, o
    // reuso de un sku que estaba en una inactiva o en otra fila que todavía
    // no se actualizó en el loop).
    const idsAFASE1 = new Set<string>()
    for (const { final, existenteId } of pareos) {
      if (!existenteId) continue
      const existente = existentesPorId.get(existenteId)
      if (existente && existente.sku_variante !== final.sku_variante) {
        idsAFASE1.add(existenteId)
      }
    }
    for (const id of idsADesactivar) {
      const existente = existentesPorId.get(id)
      if (existente && existente.sku_variante !== null) {
        idsAFASE1.add(id)
      }
    }

    if (idsAFASE1.size > 0) {
      const { error: errorFase1 } = await supabase
        .from('variantes')
        .update({ sku_variante: null })
        .in('id', Array.from(idsAFASE1))
      if (errorFase1) {
        console.error('[actualizarProducto] FASE 1 (null sku) error:', errorFase1)
        return {
          ok: false,
          error: 'Error preparando variantes: ' + errorFase1.message,
        }
      }
    }

    // FASE 2: aplicar valores finales. Las que cambian de sku ya no chocan
    // porque su sku anterior está NULL.
    for (const { final, existenteId } of pareos) {
      // Solo incluimos codigo_barras en el payload cuando el camino DEFAULT
      // explicitamente lo seteó. En el camino con variantes queda undefined
      // y no toca la columna existente.
      const codigoBarrasPatch =
        final.codigo_barras !== undefined
          ? { codigo_barras: final.codigo_barras }
          : {}

      if (existenteId) {
        const { error } = await supabase
          .from('variantes')
          .update({
            atributos: final.atributos,
            stock: final.stock,
            sku_variante: final.sku_variante,
            activa: true,
            ...codigoBarrasPatch,
          })
          .eq('id', existenteId)
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
          atributos: final.atributos,
          sku_variante: final.sku_variante,
          stock: final.stock,
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

    // Desactivar las que quedaron sin pareo. Su sku ya fue NULL'd en FASE 1.
    if (idsADesactivar.length > 0) {
      const { error: errorDesactivar } = await supabase
        .from('variantes')
        .update({ activa: false })
        .in('id', idsADesactivar)
      if (errorDesactivar) {
        console.error('[actualizarProducto] Error desactivando:', errorDesactivar)
        return {
          ok: false,
          error: 'Error desactivando variantes: ' + errorDesactivar.message,
        }
      }
    }

    revalidatePath('/admin/productos')
    revalidatePath(`/admin/productos/${productoId}`)

    return { ok: true, productoId }
  } catch (error) {
    console.error('[actualizarProducto] Error inesperado:', error)
    return { ok: false, error: 'Error inesperado' }
  }
}
