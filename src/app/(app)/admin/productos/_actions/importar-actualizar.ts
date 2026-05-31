'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito } from '@/lib/cobro/calculos'

const CAP = 1000

export type CambioImport = {
  sku_variante: string
  precio_neto?: number
  marca?: string | null
  categoria?: string | null
  activo?: boolean
  stock?: number
  activa?: boolean
  codigo_barras?: string | null
}

/** Estado actual de una variante (para que el cliente arme el diff). */
export type EstadoActualImport = {
  sku_variante: string
  sku_base: string
  nombre: string
  precio_neto: number
  marca: string | null
  categoria: string | null
  activo: boolean
  stock: number
  activa: boolean
  codigo_barras: string | null
}

export type PreviewImportResult =
  | { ok: true; actuales: EstadoActualImport[] }
  | { ok: false; error: string }

export type AplicarImportResult =
  | {
      ok: true
      afectados: number
      totalSolicitados: number
      omitidos: { sku_variante: string; motivo: string }[]
      operacionId?: string
    }
  | { ok: false; error: string }

/**
 * Resuelve el estado actual en DB de los sku_variante del archivo, para que el
 * cliente arme el diff de la preview (Fase 3, import desde export).
 */
export async function previewImportProductos(
  skus: string[]
): Promise<PreviewImportResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    if (!Array.isArray(skus) || skus.length === 0) {
      return { ok: false, error: 'No hay filas para previsualizar' }
    }
    if (skus.length > CAP) {
      return { ok: false, error: 'Máximo 1000 filas por archivo' }
    }

    const supabase = await createClient()
    // El producto ya no tiene `categoria` text: tiene marca_id/categoria_id.
    // Traemos los NOMBRES vía embed para mostrarlos en el diff del preview.
    const { data, error } = await supabase
      .from('variantes')
      .select(
        'sku_variante, stock, activa, codigo_barras, productos!inner(sku_base, nombre, precio_neto, activo, marca:marcas(nombre), categoria:catalogo_categorias(nombre))'
      )
      .in('sku_variante', skus)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[previewImportProductos]', error.message)
      return { ok: false, error: 'No se pudo cargar el estado actual' }
    }

    const actuales: EstadoActualImport[] = (data ?? []).map((v) => {
      // Los embeds llegan como objeto ({ nombre } | null) según el to-one FK.
      const p = v.productos as unknown as {
        sku_base: string
        nombre: string
        precio_neto: number
        activo: boolean
        marca: { nombre: string } | null
        categoria: { nombre: string } | null
      }
      return {
        sku_variante: v.sku_variante ?? '',
        sku_base: p.sku_base,
        nombre: p.nombre,
        precio_neto: p.precio_neto,
        marca: p.marca?.nombre ?? null,
        categoria: p.categoria?.nombre ?? null,
        activo: p.activo,
        stock: v.stock,
        activa: v.activa,
        codigo_barras: v.codigo_barras ?? null,
      }
    })

    return { ok: true, actuales }
  } catch (err) {
    console.error('[previewImportProductos]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}

/**
 * Aplica los cambios del import vía RPC atómica productos_bulk_import.
 */
export async function aplicarImportProductos(
  cambios: CambioImport[]
): Promise<AplicarImportResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    if (!Array.isArray(cambios) || cambios.length === 0) {
      return { ok: false, error: 'No hay cambios para aplicar' }
    }
    if (cambios.length > CAP) {
      return { ok: false, error: 'Máximo 1000 filas por operación' }
    }

    // Validación client-side (defense in depth; la RPC revalida).
    for (const c of cambios) {
      if (typeof c.sku_variante !== 'string' || c.sku_variante.trim() === '') {
        return { ok: false, error: 'Hay filas sin sku_variante' }
      }
      if (c.precio_neto !== undefined && (!esMontoFinito(c.precio_neto) || c.precio_neto <= 0)) {
        return { ok: false, error: 'Hay precios inválidos' }
      }
      if (c.stock !== undefined && (!Number.isInteger(c.stock) || c.stock < 0)) {
        return { ok: false, error: 'Hay valores de stock inválidos' }
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('productos_bulk_import', {
      p_usuario_id: user.id,
      p_cambios: cambios,
    })

    if (error) {
      console.error('[aplicarImportProductos] Error RPC:', error)
      return { ok: false, error: error.message || 'Error al importar' }
    }

    const r = data as {
      ok?: boolean
      afectados?: number
      total_solicitados?: number
      omitidos?: { sku_variante: string; motivo: string }[]
      operacion_id?: string
    }

    if (!r?.ok) {
      return { ok: false, error: 'No se pudieron aplicar los cambios' }
    }

    revalidatePath('/admin/productos')

    return {
      ok: true,
      afectados: r.afectados ?? 0,
      totalSolicitados: r.total_solicitados ?? cambios.length,
      omitidos: r.omitidos ?? [],
      operacionId: r.operacion_id,
    }
  } catch (err) {
    console.error('[aplicarImportProductos]', err)
    return { ok: false, error: 'Error inesperado' }
  }
}
