// src/app/superadmin/_actions/desactivar-empresa.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createAdminClient } from '@/lib/supabase/admin'

export type InfoDesactivacion = {
  facturasAprobadasCount: number
  /** ISO de la factura AFIP aprobada más reciente — null si no hay facturas. */
  fechaUltimaFacturaAfip: string | null
  /**
   * Fecha (YYYY-MM-DD) en la que la empresa se podría eliminar definitivamente
   * por RG AFIP 4290 (10 años de conservación fiscal). Null si no hay facturas.
   */
  eliminacionDefinitivaEn: string | null
}

export type DesactivarEmpresaResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Devuelve metadata sobre las consecuencias de desactivar una empresa.
 * Se usa para mostrar el warning de conservación fiscal en el dialog.
 */
export async function obtenerInfoDesactivacion(
  empresaId: string
): Promise<{ ok: true; info: InfoDesactivacion } | { ok: false; error: string }> {
  const user = await getCurrentUser()
  if (!user || user.rol !== 'superadmin') {
    return { ok: false, error: 'No autorizado' }
  }

  const admin = createAdminClient()

  const { count, error: errCount } = await admin
    .from('facturas_afip')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .in('estado', ['aprobada', 'aprobada_sin_persistir'])

  if (errCount) {
    console.error('[obtenerInfoDesactivacion] count error:', errCount)
    return { ok: false, error: 'Error consultando facturas' }
  }

  const facturasCount = count ?? 0

  let fechaUltima: string | null = null
  let eliminacionEn: string | null = null

  if (facturasCount > 0) {
    const { data: ultima } = await admin
      .from('facturas_afip')
      .select('created_at')
      .eq('empresa_id', empresaId)
      .in('estado', ['aprobada', 'aprobada_sin_persistir'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ultima) {
      fechaUltima = ultima.created_at
      const d = new Date(ultima.created_at)
      d.setUTCFullYear(d.getUTCFullYear() + 10)
      eliminacionEn = d.toISOString().slice(0, 10)
    }
  }

  return {
    ok: true,
    info: {
      facturasAprobadasCount: facturasCount,
      fechaUltimaFacturaAfip: fechaUltima,
      eliminacionDefinitivaEn: eliminacionEn,
    },
  }
}

/**
 * Soft delete de una empresa.
 *
 * - Solo superadmin.
 * - Requiere que el cliente envíe el `confirmacionNombre` exacto (estilo GitHub).
 * - Setea `empresas.activo = false` + `empresas.eliminada_at = NOW()`.
 * - Inserta entrada en `audit_log` con `es_accion_superadmin = true`
 *   y snapshot de stats en `detalle` para tener registro de qué se desactivó.
 *
 * NO elimina nada físicamente — los datos quedan intactos para
 * conservación fiscal (RG AFIP 4290 — 10 años). El aviso "Lista para
 * eliminación definitiva" se computa después en la UI; la eliminación
 * física no está implementada todavía.
 */
export async function desactivarEmpresa(input: {
  empresaId: string
  confirmacionNombre: string
}): Promise<DesactivarEmpresaResult> {
  try {
    const user = await getCurrentUser()
    if (!user || user.rol !== 'superadmin') {
      return { ok: false, error: 'No autorizado' }
    }

    const admin = createAdminClient()

    const { data: empresa, error: errEmpresa } = await admin
      .from('empresas')
      .select('id, nombre, activo')
      .eq('id', input.empresaId)
      .maybeSingle()

    if (errEmpresa || !empresa) {
      return { ok: false, error: 'La empresa no existe' }
    }

    if (!empresa.activo) {
      return { ok: false, error: 'La empresa ya está desactivada' }
    }

    if (input.confirmacionNombre.trim() !== empresa.nombre) {
      return {
        ok: false,
        error: 'El nombre no coincide con el de la empresa',
      }
    }

    // Snapshot de stats antes de desactivar (para audit)
    const [usuariosRes, ventasRes, productosRes, facturasRes] =
      await Promise.all([
        admin
          .from('usuarios')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresa.id),
        admin
          .from('ventas')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresa.id),
        admin
          .from('productos')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresa.id),
        admin
          .from('facturas_afip')
          .select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresa.id)
          .in('estado', ['aprobada', 'aprobada_sin_persistir']),
      ])

    const eliminadaAt = new Date().toISOString()

    const { error: errUpdate } = await admin
      .from('empresas')
      .update({
        activo: false,
        eliminada_at: eliminadaAt,
      })
      .eq('id', empresa.id)

    if (errUpdate) {
      console.error('[desactivarEmpresa] update error:', errUpdate)
      return { ok: false, error: 'Error al desactivar la empresa' }
    }

    await admin.from('audit_log').insert({
      empresa_id: empresa.id,
      usuario_id: user.id,
      usuario_email_snapshot: user.email,
      entidad: 'empresas',
      entidad_id: empresa.id,
      accion: 'desactivar_empresa',
      es_accion_superadmin: true,
      detalle: {
        nombre: empresa.nombre,
        eliminada_at: eliminadaAt,
        snapshot: {
          usuarios: usuariosRes.count ?? 0,
          ventas: ventasRes.count ?? 0,
          productos: productosRes.count ?? 0,
          facturas_afip_aprobadas: facturasRes.count ?? 0,
        },
      },
    })

    revalidatePath('/superadmin')

    return { ok: true }
  } catch (err) {
    console.error('[desactivarEmpresa] error inesperado:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}
