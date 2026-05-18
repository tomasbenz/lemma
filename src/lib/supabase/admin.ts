// src/lib/supabase/admin.ts
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Cliente Supabase con privilegios de service_role.
 *
 * ⚠️ ADVERTENCIA: BYPASEA TODAS LAS POLÍTICAS RLS.
 *
 * Casos de uso válidos:
 *   - Superadmin impersonando una empresa (necesita ver TODAS las empresas)
 *   - Server actions de gestión de empresas/usuarios desde panel /superadmin
 *   - Webhooks externos (sin sesión de usuario)
 *
 * NUNCA importar desde Client Components (se expone al browser).
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}