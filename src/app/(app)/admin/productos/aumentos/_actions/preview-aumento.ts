'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeEditarCatalogo } from '@/lib/auth/permisos'
import { esMontoFinito, round2 } from '@/lib/cobro/calculos'
import {
  redondearPrecio,
  esEstrategiaRedondeo,
  type EstrategiaRedondeo,
} from '@/lib/precios/redondeo'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PAGE_SIZE = 1000
const EJEMPLOS_POR_CATEGORIA = 5

export type PreviewAjuste = { categoria_id: string; pct: number }

export type PreviewAumentoInput = {
  marca_id: string | null
  ajustes: PreviewAjuste[]
  redondeo: EstrategiaRedondeo
}

export type PreviewCategoria = {
  categoria_id: string
  categoria_nombre: string
  pct: number
  n_productos: number
  prom_actual: number
  prom_estimado: number
  /** true si algún producto de la categoría quedaría en $0 tras redondear. */
  riesgo_cero: boolean
}

export type PreviewEjemplo = {
  producto_id: string
  nombre: string
  categoria_nombre: string
  precio_actual: number
  precio_estimado: number
}

export type PreviewAumentoResultado =
  | {
      ok: true
      por_categoria: PreviewCategoria[]
      total_afectados: number
      productos_sin_categoria_en_scope: number
      ejemplos: PreviewEjemplo[]
      hay_negativos: boolean
      hay_riesgo_cero: boolean
    }
  | { ok: false; error: string }

type FilaProducto = {
  id: string
  nombre: string
  precio_neto: number
  categoria_id: string | null
}

/**
 * Calcula el preview de un aumento por categoría SIN tocar la DB.
 *
 * Decisión de diseño (Fase A): no hay RPC de preview. Se traen los productos
 * en scope (paginados) y se agrega en TS con el mismo helper de redondeo que
 * usa la RPC del apply, así lo que el usuario ve == lo que se va a aplicar.
 *
 * Se evita la agregación vía PostgREST (avg/group by) porque depende de que el
 * proyecto tenga habilitadas las funciones de agregación; agregar en TS es
 * robusto y el scope está acotado a las categorías con % cargado.
 */
export async function previewAumento(
  input: PreviewAumentoInput
): Promise<PreviewAumentoResultado> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (!puedeEditarCatalogo(user.rol)) {
      return { ok: false, error: 'No tenés permisos' }
    }
    if (!user.empresa_id) return { ok: false, error: 'Sesión inválida' }

    if (!esEstrategiaRedondeo(input.redondeo)) {
      return { ok: false, error: 'Redondeo inválido' }
    }
    if (input.marca_id !== null && !UUID_RE.test(input.marca_id)) {
      return { ok: false, error: 'Marca inválida' }
    }
    if (!Array.isArray(input.ajustes)) {
      return { ok: false, error: 'Ajustes inválidos' }
    }

    // Validar + quedarnos solo con los ajustes con pct distinto de 0.
    const ajustesPorCat = new Map<string, number>()
    for (const a of input.ajustes) {
      if (!a || typeof a.categoria_id !== 'string' || !UUID_RE.test(a.categoria_id)) {
        return { ok: false, error: 'Categoría inválida en los ajustes' }
      }
      if (!esMontoFinito(a.pct) || a.pct <= -100) {
        return { ok: false, error: 'Porcentaje inválido (debe ser > -100)' }
      }
      if (a.pct !== 0) ajustesPorCat.set(a.categoria_id, a.pct)
    }

    const hayNegativos = [...ajustesPorCat.values()].some((p) => p < 0)

    if (ajustesPorCat.size === 0) {
      return {
        ok: true,
        por_categoria: [],
        total_afectados: 0,
        productos_sin_categoria_en_scope: 0,
        ejemplos: [],
        hay_negativos: false,
        hay_riesgo_cero: false,
      }
    }

    const supabase = await createClient()
    const empresaId = user.empresa_id
    const categoriaIds = [...ajustesPorCat.keys()]

    // Nombres de categoría.
    const { data: cats, error: catsError } = await supabase
      .from('catalogo_categorias')
      .select('id, nombre')
      .eq('empresa_id', empresaId)
      .in('id', categoriaIds)

    if (catsError) {
      console.error('[previewAumento] cats:', catsError.message)
      return { ok: false, error: 'No se pudo cargar el catálogo' }
    }
    const nombrePorCat = new Map<string, string>(
      (cats ?? []).map((c) => [c.id as string, c.nombre as string])
    )

    // Productos en scope (paginado para superar el límite de 1000 de PostgREST).
    const productos: FilaProducto[] = []
    for (let desde = 0; ; desde += PAGE_SIZE) {
      let q = supabase
        .from('productos')
        .select('id, nombre, precio_neto, categoria_id')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .in('categoria_id', categoriaIds)
        .order('precio_neto', { ascending: false })
        .range(desde, desde + PAGE_SIZE - 1)
      if (input.marca_id !== null) q = q.eq('marca_id', input.marca_id)

      const { data, error } = await q
      if (error) {
        console.error('[previewAumento] productos:', error.message)
        return { ok: false, error: 'No se pudieron cargar los productos' }
      }
      if (!data || data.length === 0) break
      productos.push(...(data as FilaProducto[]))
      if (data.length < PAGE_SIZE) break
    }

    // Agregación en TS por categoría.
    type Acc = { n: number; suma: number; ejemplos: FilaProducto[]; riesgoCero: boolean }
    const acc = new Map<string, Acc>()
    for (const p of productos) {
      const catId = p.categoria_id
      if (!catId || !ajustesPorCat.has(catId)) continue
      const pct = ajustesPorCat.get(catId)!
      let a = acc.get(catId)
      if (!a) {
        a = { n: 0, suma: 0, ejemplos: [], riesgoCero: false }
        acc.set(catId, a)
      }
      a.n += 1
      a.suma += p.precio_neto
      // Productos ya vienen ordenados por precio desc → los primeros 5 son los
      // más caros (más visibles para el usuario).
      if (a.ejemplos.length < EJEMPLOS_POR_CATEGORIA) a.ejemplos.push(p)
      // Riesgo cero: algún producto con precio > 0 que redondea a 0.
      if (p.precio_neto > 0) {
        const est = redondearPrecio(p.precio_neto * (1 + pct / 100), input.redondeo)
        if (est === 0) a.riesgoCero = true
      }
    }

    const porCategoria: PreviewCategoria[] = []
    const ejemplos: PreviewEjemplo[] = []
    let totalAfectados = 0

    for (const [catId, pct] of ajustesPorCat) {
      const a = acc.get(catId)
      const nombre = nombrePorCat.get(catId) ?? 'Categoría'
      const n = a?.n ?? 0
      totalAfectados += n
      const promActual = n > 0 ? round2(a!.suma / n) : 0
      const promEstimado =
        n > 0 ? redondearPrecio(promActual * (1 + pct / 100), input.redondeo) : 0

      porCategoria.push({
        categoria_id: catId,
        categoria_nombre: nombre,
        pct,
        n_productos: n,
        prom_actual: promActual,
        prom_estimado: promEstimado,
        riesgo_cero: a?.riesgoCero ?? false,
      })

      for (const e of a?.ejemplos ?? []) {
        ejemplos.push({
          producto_id: e.id,
          nombre: e.nombre,
          categoria_nombre: nombre,
          precio_actual: e.precio_neto,
          precio_estimado: redondearPrecio(
            e.precio_neto * (1 + pct / 100),
            input.redondeo
          ),
        })
      }
    }

    // Ordenar categorías por nombre para presentación estable.
    porCategoria.sort((x, y) =>
      x.categoria_nombre.localeCompare(y.categoria_nombre, 'es')
    )

    // Productos sin categoría en el scope (head count). Se excluyen del aumento;
    // se informa para que el usuario sepa que existen.
    let sinCatQuery = supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .is('categoria_id', null)
    if (input.marca_id !== null) sinCatQuery = sinCatQuery.eq('marca_id', input.marca_id)
    const { count: sinCat } = await sinCatQuery

    return {
      ok: true,
      por_categoria: porCategoria,
      total_afectados: totalAfectados,
      productos_sin_categoria_en_scope: sinCat ?? 0,
      ejemplos,
      hay_negativos: hayNegativos,
      hay_riesgo_cero: porCategoria.some((c) => c.riesgo_cero),
    }
  } catch (error) {
    console.error('[previewAumento] inesperado:', error)
    return { ok: false, error: 'Error inesperado al calcular el preview' }
  }
}
