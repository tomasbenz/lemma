import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

/**
 * Cliente Supabase para Server Components, Server Actions y Route Handlers.
 *
 * - Lee las cookies de sesión del usuario
 * - Respeta todas las políticas RLS
 * - Usa la anon key (no service_role)
 *
 * Uso:
 *   - Server Components (page.tsx, layout.tsx)
 *   - Server Actions
 *   - Route Handlers (route.ts)
 *
 * @example
 * // En un Server Component:
 * import { createClient } from '@/lib/supabase/server'
 *
 * export default async function Page() {
 *   const supabase = await createClient()
 *   const { data } = await supabase.from('productos').select()
 *   return <div>{data?.length} productos</div>
 * }
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll() falla desde Server Components puros (no pueden modificar cookies).
            // Los middlewares y Server Actions refrescan la sesión correctamente.
            // Este try/catch se puede ignorar.
          }
        },
      },
    }
  )
}