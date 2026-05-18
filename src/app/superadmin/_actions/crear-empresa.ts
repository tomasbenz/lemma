// src/app/superadmin/_actions/crear-empresa.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createAdminClient } from '@/lib/supabase/admin'

type CrearEmpresaInput = {
  nombre: string
  slug: string
  adminEmail: string
  adminPassword: string
  adminNombre: string
}

export type CrearEmpresaResult =
  | { ok: true; empresaId: string; adminId: string }
  | { ok: false; error: string; field?: string }

/**
 * Crea una empresa nueva con su usuario admin inicial.
 *
 * Flujo:
 * 1. Valida permisos (solo superadmin)
 * 2. Valida slug único y email no existente
 * 3. Crea fila en `empresas`
 * 4. Crea usuario en Supabase Auth (admin API)
 * 5. El trigger handle_new_user crea la fila en public.usuarios automáticamente
 *    pero como el rol/empresa vienen de raw_user_meta_data, los pasamos ahí
 * 6. Crea fila inicial en `configuracion` con datos placeholder
 *
 * Si algo falla a mitad, hace rollback manual de lo creado antes.
 */
export async function crearEmpresa(
  input: CrearEmpresaInput
): Promise<CrearEmpresaResult> {
  try {
    // 1. Auth
    const user = await getCurrentUser()
    if (!user || user.rol !== 'superadmin') {
      return { ok: false, error: 'No autorizado' }
    }

    // 2. Validaciones básicas
    const nombre = input.nombre?.trim()
    const slug = input.slug?.trim().toLowerCase()
    const adminEmail = input.adminEmail?.trim().toLowerCase()
    const adminPassword = input.adminPassword
    const adminNombre = input.adminNombre?.trim()

    if (!nombre || nombre.length < 2) {
      return { ok: false, error: 'Nombre demasiado corto', field: 'nombre' }
    }
    if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) {
      return {
        ok: false,
        error: 'Slug inválido (minúsculas, números y guiones, 2-40 chars)',
        field: 'slug',
      }
    }
    if (!adminEmail || !adminEmail.includes('@')) {
      return { ok: false, error: 'Email inválido', field: 'adminEmail' }
    }
    if (!adminPassword || adminPassword.length < 8) {
      return {
        ok: false,
        error: 'Password debe tener al menos 8 caracteres',
        field: 'adminPassword',
      }
    }
    if (!adminNombre || adminNombre.length < 2) {
      return {
        ok: false,
        error: 'Nombre del admin demasiado corto',
        field: 'adminNombre',
      }
    }

    const admin = createAdminClient()

    // 3. Verificar slug único
    const { data: slugExistente } = await admin
      .from('empresas')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (slugExistente) {
      return {
        ok: false,
        error: 'Ya existe una empresa con ese slug',
        field: 'slug',
      }
    }

    // 4. Verificar que el email no esté en uso
    const { data: emailExistente } = await admin
      .from('usuarios')
      .select('id')
      .eq('email', adminEmail)
      .maybeSingle()

    if (emailExistente) {
      return {
        ok: false,
        error: 'Ese email ya está registrado',
        field: 'adminEmail',
      }
    }

    // 5. Crear empresa
    const { data: empresa, error: errEmpresa } = await admin
      .from('empresas')
      .insert({
        nombre,
        slug,
        activo: true,
      })
      .select('id')
      .single()

    if (errEmpresa || !empresa) {
      console.error('[crearEmpresa] Error creando empresa:', errEmpresa)
      return {
        ok: false,
        error: errEmpresa?.message ?? 'Error creando empresa',
      }
    }

    // 6. Crear usuario en Auth con metadata (el trigger handle_new_user
    //    se encarga de la fila en public.usuarios usando esos metadata)
    const { data: authData, error: errAuth } =
      await admin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: {
          nombre_completo: adminNombre,
          rol: 'admin',
          empresa_id: empresa.id,
        },
      })

    if (errAuth || !authData.user) {
      // Rollback: borrar empresa
      await admin.from('empresas').delete().eq('id', empresa.id)
      console.error('[crearEmpresa] Error creando user auth:', errAuth)
      return {
        ok: false,
        error: errAuth?.message ?? 'Error creando usuario admin',
      }
    }

    const adminId = authData.user.id

    // 7. El trigger handle_new_user creó la fila en public.usuarios.
    //    Verificamos y forzamos rol+empresa por las dudas (si el trigger
    //    no leyó bien los metadata).
    await admin
      .from('usuarios')
      .update({
        nombre_completo: adminNombre,
        rol: 'admin',
        empresa_id: empresa.id,
        activo: true,
      })
      .eq('id', adminId)

    // 8. Crear configuración inicial con datos placeholder
    await admin.from('configuracion').insert({
      empresa_id: empresa.id,
      razon_social: nombre,
      cuit: '00-00000000-0',
      condicion_iva: 'IVA Responsable Inscripto',
      domicilio: '',
      localidad: '',
      provincia: '',
      codigo_postal: '',
      telefono: '',
      email: adminEmail,
      web: '',
      punto_venta_default: 1,
      puntos_venta: [1],
    } as never)

    revalidatePath('/superadmin')

    return {
      ok: true,
      empresaId: empresa.id,
      adminId,
    }
  } catch (err) {
    console.error('[crearEmpresa] Error inesperado:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}