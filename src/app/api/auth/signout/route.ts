import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Endpoint para cerrar sesión.
 * Se invoca con POST desde el botón de logout.
 * Después de cerrar sesión, redirige a /login.
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    // Registrar el logout en el audit log
    await supabase.from('audit_log').insert({
      usuario_id: user.id,
      usuario_email_snapshot: user.email ?? null,
      entidad: 'auth',
      entidad_id: user.id,
      accion: 'logout',
    })

    // Cerrar sesión
    await supabase.auth.signOut()
  }

  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/login`, {
    // Status 303 fuerza el método GET en la redirección
    status: 303,
  })
}