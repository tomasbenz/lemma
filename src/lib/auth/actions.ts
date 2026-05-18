'use server'

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { loginSchema, type LoginInput } from '@/lib/validations/auth'
import { getDefaultRoute } from './get-current-user'

export type LoginResult =
  | { success: true; redirectTo: string }
  | { success: false; error: string }

/**
 * Server Action para hacer login con email + password.
 *
 * - Valida el input con Zod
 * - Hace login en Supabase Auth
 * - Verifica que el usuario exista en public.usuarios y esté activo
 * - Registra el login en audit_log (IP, user agent)
 * - Devuelve la ruta de redirección según el rol
 *
 * SEGURIDAD:
 * - Toda la función está envuelta en try/catch para evitar que errores
 *   no controlados expongan el input (que incluye el password) en logs.
 * - Los logs internos NUNCA incluyen el objeto `input` completo, solo
 *   metadatos seguros (email visible, status, etc).
 */
export async function loginAction(input: LoginInput): Promise<LoginResult> {
  try {
    // 1. Validar el input
    const parsed = loginSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      }
    }

    const { email, password } = parsed.data

    // 2. Hacer login en Supabase Auth
    const supabase = await createClient()

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (authError) {
      // Mensajes más amigables para errores comunes
      if (authError.message.includes('Invalid login credentials')) {
        return {
          success: false,
          error: 'Email o contraseña incorrectos',
        }
      }
      if (authError.message.includes('Email not confirmed')) {
        return {
          success: false,
          error: 'El email no fue confirmado. Contactá al administrador.',
        }
      }
      return {
        success: false,
        error: authError.message || 'Error al iniciar sesión',
      }
    }

    if (!authData.user) {
      return {
        success: false,
        error: 'No se pudo obtener el usuario',
      }
    }

    // 3. Verificar que el usuario exista en public.usuarios y esté activo
    const { data: dbUser, error: dbError } = await supabase
      .from('usuarios')
      .select('id, email, nombre_completo, rol, activo, empresa_id')
      .eq('id', authData.user.id)
      .single()

    if (dbError || !dbUser) {
      // Usuario auth existe pero no está vinculado en la tabla usuarios.
      // Cerrar sesión inmediatamente para evitar estados inconsistentes.
      await supabase.auth.signOut()
      return {
        success: false,
        error: 'Tu cuenta no está configurada. Contactá al administrador.',
      }
    }

    if (!dbUser.activo) {
      await supabase.auth.signOut()
      return {
        success: false,
        error: 'Tu cuenta está desactivada. Contactá al administrador.',
      }
    }

    // Bloquear login si la empresa del usuario está desactivada.
    // (superadmin sin empresa_id no se ve afectado.)
    if (dbUser.rol !== 'superadmin' && dbUser.empresa_id) {
      const { data: empresa } = await supabase
        .from('empresas')
        .select('activo')
        .eq('id', dbUser.empresa_id)
        .maybeSingle()

      if (!empresa || !empresa.activo) {
        await supabase.auth.signOut()
        return {
          success: false,
          error: 'La empresa está desactivada. Contactá al administrador.',
        }
      }
    }

    // 4. Registrar el login en audit_log via RPC
    const hdrs = await headers()
    const forwardedFor = hdrs.get('x-forwarded-for')
    const realIp = hdrs.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0]?.trim() ?? realIp ?? undefined
    const userAgent = hdrs.get('user-agent') ?? undefined

    await supabase.rpc('registrar_login', {
      p_ip: ip as unknown as never, // `inet` en Postgres, se serializa como string
      p_user_agent: userAgent,
    })

    // 5. Devolver la ruta según rol
    return {
      success: true,
      redirectTo: getDefaultRoute(dbUser.rol),
    }
  } catch (error) {
    // IMPORTANTE: nunca incluir `input`, `email` ni `password` en este log.
    // Solo loguear el mensaje técnico para diagnóstico.
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[loginAction] Error interno:', message)

    // Detectar errores de conectividad para dar un mensaje útil al usuario
    if (
      message.includes('fetch failed') ||
      message.includes('ENOTFOUND') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT')
    ) {
      return {
        success: false,
        error:
          'No se pudo conectar con el servidor. Revisá tu conexión a internet.',
      }
    }

    return {
      success: false,
      error: 'Error al iniciar sesión. Intentá de nuevo en unos segundos.',
    }
  }
}