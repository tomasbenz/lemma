// src/lib/features.ts
//
// Feature flags por empresa. Cada empresa tiene una columna `features jsonb`
// con flags booleanos. Si la columna no existe o el flag no está, se asume
// false (todos los features están apagados por default).
//
// Para Lemma + Librería Samu el default es {} → todos los features
// específicos quedan ocultos (recargo manual, facturación parcial, etc.).
// El cliente "Iconic Fashion" del proyecto original tenía features
// activadas; acá quedan dormidas hasta que alguien las habilite por empresa.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type EmpresaFeatures = {
  /**
   * Habilita los toggles UI del recargo manual:
   *  - Checkbox "Cobrar 10,5% extra al cliente" en modal de cobro.
   *  - Botón "+ Recargo (ej: 30% tarjeta)" con porcentaje libre.
   *  - Presets 30/50/100% para "Monto a facturar" parcial.
   *  - Card "Asignar facturación" parcial con presets en /admin/ventas.
   *
   * El código y columnas del recargo (`recargo_porcentaje_manual`,
   * `recargo_motivo`, `recargo_factura_completa`, `monto_facturado`)
   * siguen vivos para empresas que activen este flag. Si el flag está
   * apagado se ignoran en el server action y se ocultan en la UI.
   */
  recargo_manual_habilitado?: boolean
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

  // `features` es jsonb. Supabase lo devuelve como objeto JS o null si la
  // columna está NULL. Tipamos a record para extraer flags conocidos.
  const raw = (data as { features?: Record<string, unknown> | null }).features
  if (!raw || typeof raw !== 'object') return {}

  return {
    recargo_manual_habilitado: raw.recargo_manual_habilitado === true,
  }
}

/**
 * Helper específico: ¿la empresa tiene habilitado el recargo manual?
 *
 * Equivalente a `(await getEmpresaFeatures(empresaId)).recargo_manual_habilitado === true`,
 * pero como esto se consulta desde el server action del cobro y desde el
 * page server-side de admin/ventas, justifica un helper dedicado.
 */
export async function isRecargoManualHabilitado(
  empresaId: string,
): Promise<boolean> {
  const features = await getEmpresaFeatures(empresaId)
  return features.recargo_manual_habilitado === true
}
