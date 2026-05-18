import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Callback de Supabase Auth.
 * Se dispara cuando un usuario vuelve de un flow de OAuth (Google, etc)
 * o confirma su email.
 *
 * Por ahora solo lo dejamos listo para cuando habilitemos Google Login.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Si hay error, redirigir al login con mensaje
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}