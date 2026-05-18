// src/lib/features.ts
//
// Feature flags por empresa. Cada empresa tiene una columna `features jsonb`
// con flags booleanos. Si la columna no existe o el flag no está, se asume
// false (todos los features están apagados por default — fail-closed).
//
// Para Lemma + Samu el estado canónico es:
//   { recargo_manual_habilitado: true, recargo_105_habilitado: false }
// → toggles de descuento + recargo manual % + presets de facturación parcial,
// SIN el checkbox del 10,5% (Samu no opera el split fiscal).
//
// Para empresas migradas desde Loom Point (caso Iconic Fashion histórico)
// ambos flags arrancan en true para preservar el comportamiento.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type EmpresaFeatures = {
  /**
   * Habilita los toggles UI ligados al recargo manual y la facturación parcial:
   *  - Botón "+ Aplicar recargo manual" + formulario de porcentaje libre.
   *  - Presets 30/50/100% para "Monto a facturar" parcial.
   *  - Input numérico de "Monto a facturar" editable libremente.
   *  - Card "Asignar facturación parcial" en /admin/ventas con presets.
   *
   * No incluye el checkbox del 10,5% (eso vive en recargo_105_habilitado).
   *
   * El código y columnas DB del recargo manual (`recargo_porcentaje_manual`,
   * `recargo_motivo`, `monto_facturado < total`) siguen vivos para empresas
   * con el flag activo. Si está apagado se ignoran en el server action y se
   * ocultan en la UI.
   */
  recargo_manual_habilitado?: boolean

  /**
   * Habilita el checkbox "Cobrar 10,5% extra al cliente" en el modal de cobro
   * + bloque "Recargo 10,5%" en el resumen de totales.
   *
   * Usado por emisores RI que aplican el split fiscal donde se factura el
   * 100% del total con un 10,5% adicional para cubrir IVA reducido. Samu
   * no opera así (boletas simples, sin split) → flag default false.
   *
   * El código y la columna DB `ventas.recargo_factura_completa` siguen vivos
   * para empresas con este flag activo. El server action descarta cualquier
   * intento de marcarlo si el flag está apagado (defense in depth).
   */
  recargo_105_habilitado?: boolean
}

/**
 * Lee el jsonb `features` de la empresa y devuelve un objeto tipado.
 * Si la empresa no existe, devuelve `{}` (todos los features apagados).
 */
export async function getEmpresaFeatures(
  empresaId: string,
): Promise<EmpresaFeatures> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('empresas')
    .select('features')
    .eq('id', empresaId)
    .maybeSingle()

  if (error || !data) {
    return {}
  }

  const raw = (data as { features?: Record<string, unknown> | null }).features
  if (!raw || typeof raw !== 'object') return {}

  return {
    recargo_manual_habilitado: raw.recargo_manual_habilitado === true,
    recargo_105_habilitado: raw.recargo_105_habilitado === true,
  }
}

/**
 * ¿La empresa tiene habilitado el recargo manual + facturación parcial?
 * Controla: botón "+ Aplicar recargo manual", presets 30/50/100, input
 * libre de monto a facturar.
 */
export async function isRecargoManualHabilitado(
  empresaId: string,
): Promise<boolean> {
  const features = await getEmpresaFeatures(empresaId)
  return features.recargo_manual_habilitado === true
}

/**
 * ¿La empresa tiene habilitado el checkbox del 10,5%?
 * Controla SOLO el checkbox "Cobrar 10,5% extra al cliente" + el bloque
 * de resumen "Recargo 10,5%". Independiente de recargo_manual_habilitado.
 */
export async function isRecargo105Habilitado(
  empresaId: string,
): Promise<boolean> {
  const features = await getEmpresaFeatures(empresaId)
  return features.recargo_105_habilitado === true
}
