// src/app/(app)/admin/configuracion/_actions/actualizar-configuracion.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { configuracionSchema } from '@/lib/validations/configuracion'

export type ActualizarConfiguracionResult =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> }

/**
 * Convierte el valor de un FormData a string o undefined.
 * Importante: NO devolver null, porque z.string().optional() solo acepta
 * string | undefined. El schema se encarga de transformar a null después
 * de validar.
 */
function getStringOrUndef(formData: FormData, key: string): string | undefined {
  const v = formData.get(key)
  if (v === null) return undefined
  const s = v.toString().trim()
  return s === '' ? undefined : s
}

export async function actualizarConfiguracion(
  formData: FormData
): Promise<ActualizarConfiguracionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: 'No autenticado' }
    if (user.rol !== 'admin' && user.rol !== 'superadmin') {
      return {
        ok: false,
        error: 'No tenés permisos para modificar la configuración',
      }
    }

    // Parsear puntos_venta desde FormData. Vienen como múltiples values.
    const puntosRaw = formData.getAll('puntos_venta')
    const puntos_venta = puntosRaw
      .map((p) => Number(p?.toString().trim()))
      .filter((n) => Number.isFinite(n) && n > 0)

    const data = {
      razon_social: formData.get('razon_social')?.toString() ?? '',
      cuit: formData.get('cuit')?.toString() ?? '',
      condicion_iva: formData.get('condicion_iva')?.toString() ?? '',
      ingresos_brutos: getStringOrUndef(formData, 'ingresos_brutos'),
      inicio_actividades: getStringOrUndef(formData, 'inicio_actividades'),
      domicilio: getStringOrUndef(formData, 'domicilio'),
      localidad: getStringOrUndef(formData, 'localidad'),
      provincia: getStringOrUndef(formData, 'provincia'),
      codigo_postal: getStringOrUndef(formData, 'codigo_postal'),
      telefono: getStringOrUndef(formData, 'telefono'),
      email: getStringOrUndef(formData, 'email'),
      web: getStringOrUndef(formData, 'web'),
      punto_venta_default: Number(
        formData.get('punto_venta_default')?.toString() ??
          puntos_venta[0] ??
          1
      ),
      puntos_venta,
      umbral_stock_bajo: Number(
        formData.get('umbral_stock_bajo')?.toString() ?? 5
      ),
    }

    const parsed = configuracionSchema.safeParse(data)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Datos inválidos',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[]
        >,
      }
    }

    const supabase = await createClient()

    // Sincronizar punto_venta_default con el primer elemento del array
    // por compatibilidad con código legacy
    const update = {
      ...parsed.data,
      punto_venta_default: parsed.data.puntos_venta[0],
    }

    if (!user.empresa_id) {
      return { ok: false, error: 'Sin empresa activa' }
    }

    const { error } = await supabase
      .from('configuracion')
      .update(update)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[actualizarConfiguracion]', error)
      return { ok: false, error: error.message ?? 'Error al guardar' }
    }

    // Audit log
    await supabase.from('audit_log').insert({
      usuario_id: user.id,
      usuario_email_snapshot: user.email,
      entidad: 'configuracion',
      entidad_id: '1',
      accion: 'actualizar_configuracion',
    })

    revalidatePath('/admin/configuracion')

    return { ok: true }
  } catch (error) {
    console.error('[actualizarConfiguracion] Error inesperado:', error)
    const msg = error instanceof Error ? error.message : 'Error inesperado'
    return { ok: false, error: msg }
  }
}