import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Cliente Supabase para Client Components (browser).
 *
 * - Usa la anon key pública
 * - Respeta todas las políticas RLS
 * - Mantiene la sesión del usuario via cookies
 *
 * Uso: importar en componentes con 'use client'.
 *
 * @example
 * 'use client'
 * import { createClient } from '@/lib/supabase/client'
 *
 * const supabase = createClient()
 * const { data } = await supabase.from('productos').select()
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}