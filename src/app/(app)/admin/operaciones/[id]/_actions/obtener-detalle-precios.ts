'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { round2 } from '@/lib/cobro/calculos'

const VENTANA_HORAS = 24
const PRICE_ACCIONES = [
  'precio_individual',
  'precio_pct',
  'precio_fijo',
  'aumento_workspace',
  'reversion_precios',
]

export type DetallePrecioFila = {
  producto_id: string
  producto_nombre: string
  producto_sku: string | null
  precio_anterior: number
  precio_nuevo: number
  /** (nuevo - anterior) / anterior * 100, redondeado a 2. */
  diff_porcentual: number
}

export type DetalleOperacionPrecios = {
  filas: DetallePrecioFila[]
  total_filas: number
  puede_deshacer: boolean
  razon_no_deshacer: string | null
  ya_revertida: boolean
  reversion_id: string | null
}

const pobre = (razon: string | null): DetalleOperacionPrecios => ({
  filas: [],
  total_filas: 0,
  puede_deshacer: false,
  razon_no_deshacer: razon,
  ya_revertida: false,
  reversion_id: null,
})

/**
 * Devuelve el detalle de precios de una operación (viejo→nuevo por producto) y
 * si se puede deshacer. Las 4 condiciones se evalúan acá SOLO para habilitar el
 * botón; la RPC `revertir_operacion_precios` vuelve a validar al confirmar.
 */
export async function obtenerDetallePrecios(
  operacionId: string
): Promise<DetalleOperacionPrecios> {
  try {
    const user = await getCurrentUser()
    if (!user || !puedeEditarCatalogo(user.rol) || !user.empresa_id) {
      return pobre(null)
    }

    const supabase = await createClient()
    const empresaId = user.empresa_id

    // Operación (para accion + creado_at).
    const { data: op } = await supabase
      .from('operaciones_masivas')
      .select('accion, creado_at')
      .eq('id', operacionId)
      .eq('empresa_id', empresaId)
      .maybeSingle()
    if (!op) return pobre(null)

    // Detalle.
    const { data: det } = await supabase
      .from('operaciones_masivas_precio_detalle')
      .select(
        'producto_id, producto_nombre_snapshot, producto_sku_snapshot, precio_anterior, precio_nuevo'
      )
      .eq('operacion_id', operacionId)
      .eq('empresa_id', empresaId)
      .order('producto_nombre_snapshot', { ascending: true })

    if (!det || det.length === 0) {
      return pobre('Esta operación no tiene detalle de precios (es anterior a Fase B)')
    }

    const filas: DetallePrecioFila[] = det.map((d) => {
      const ant = Number(d.precio_anterior)
      const nue = Number(d.precio_nuevo)
      return {
        producto_id: d.producto_id as string,
        producto_nombre: d.producto_nombre_snapshot as string,
        producto_sku: (d.producto_sku_snapshot as string | null) ?? null,
        precio_anterior: ant,
        precio_nuevo: nue,
        diff_porcentual: ant > 0 ? round2(((nue - ant) / ant) * 100) : 0,
      }
    })

    // ¿Ya fue revertida? (filtramos en JS para no tipar un column JSON-path)
    const { data: reversiones } = await supabase
      .from('operaciones_masivas')
      .select('id, parametros, creado_at')
      .eq('empresa_id', empresaId)
      .eq('accion', 'reversion_precios')
    const rev = (reversiones ?? []).find((r) => {
      const p = r.parametros as { operacion_original_id?: string } | null
      return (
        p && typeof p === 'object' && !Array.isArray(p) &&
        p.operacion_original_id === operacionId
      )
    })
    const yaRevertida = !!rev
    const reversionId = (rev?.id as string | undefined) ?? null

    const base = {
      filas,
      total_filas: filas.length,
      ya_revertida: yaRevertida,
      reversion_id: reversionId,
    }

    // Una reversión no se deshace.
    if (op.accion === 'reversion_precios') {
      return { ...base, puede_deshacer: false, razon_no_deshacer: 'Una reversión no se puede deshacer' }
    }
    if (yaRevertida) {
      return { ...base, puede_deshacer: false, razon_no_deshacer: 'Esta operación ya fue revertida' }
    }

    // Ventana de 24h.
    const horas = (Date.now() - new Date(op.creado_at).getTime()) / 3_600_000
    if (horas > VENTANA_HORAS) {
      return {
        ...base,
        puede_deshacer: false,
        razon_no_deshacer: 'La operación es de hace más de 24 horas',
      }
    }

    // ¿Hay una operación de precios posterior?
    const { data: posteriores } = await supabase
      .from('operaciones_masivas')
      .select('id')
      .eq('empresa_id', empresaId)
      .in('accion', PRICE_ACCIONES)
      .neq('id', operacionId)
      .gt('creado_at', op.creado_at)
      .limit(1)
    if ((posteriores?.length ?? 0) > 0) {
      return {
        ...base,
        puede_deshacer: false,
        razon_no_deshacer:
          'Hay una operación de precios posterior. Solo se puede deshacer la última.',
      }
    }

    // ¿Algún producto fue editado después? (margen 5s por el propio UPDATE)
    const margen = new Date(new Date(op.creado_at).getTime() + 5_000).toISOString()
    const productoIds = filas.map((f) => f.producto_id)
    const { count: tocados } = await supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .in('id', productoIds)
      .gt('updated_at', margen)
    if ((tocados ?? 0) > 0) {
      return {
        ...base,
        puede_deshacer: false,
        razon_no_deshacer: 'Algún producto fue editado después de la operación',
      }
    }

    return { ...base, puede_deshacer: true, razon_no_deshacer: null }
  } catch (error) {
    console.error('[obtenerDetallePrecios] inesperado:', error)
    return pobre(null)
  }
}
