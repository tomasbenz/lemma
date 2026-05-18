// src/app/api/auth/signout/route.ts
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearEmpresaActiva } from '@/lib/auth/empresa-activa'
import { NextResponse } from 'next/server'

/**
 * Endpoint para cerrar sesión.
 * Se invoca con POST desde el botón de logout.
 * Después de cerrar sesión, redirige a /login.
 *
 * Para superadmin: además restaura empresa_id = NULL para que
 * el próximo login arranque limpio sin impersonar.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    // Si superadmin, limpiar empresa_id en tabla usuarios
    const { data: dbUser } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single()

    if (dbUser?.rol === 'superadmin') {
      const admin = createAdminClient()
      await admin
        .from('usuarios')
        .update({ empresa_id: null })
        .eq('id', user.id)
    }

    // Registrar el logout en el audit log
    await supabase.from('audit_log').insert({
      usuario_id: user.id,
      usuario_email_snapshot: user.email ?? null,
      entidad: 'auth',
      entidad_id: user.id,
      accion: 'logout',
    })

    await supabase.auth.signOut()
  }

  // Limpiar cookie de empresa activa
  await clearEmpresaActiva()

  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/login`, {
    status: 303,
  })
}