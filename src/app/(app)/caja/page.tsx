// src/app/(app)/caja/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  isRecargoManualHabilitado,
  isRecargo105Habilitado,
} from '@/lib/features'
import { CajaView } from './_components/caja-view'

export const metadata = {
  title: 'Caja',
}

/**
 * Página de Caja.
 *
 * En el server cargamos sólo lo necesario para validar sesión y resolver
 * feature flags por empresa. Los datos del catálogo (productos + clientes)
 * los carga CajaView en cliente via /api/sync/catalog, con fallback a
 * IndexedDB cuando no hay internet.
 *
 * Trade-off: hay un loader breve (~200-500ms) en la primera carga vs el SSR
 * de antes. A cambio ganamos modo offline y sincronización en tiempo real.
 */
export default async function CajaPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Feature flags por empresa. Si user no tiene empresa_id, ambos quedan
  // en false (fail-closed). Para Samu: manual=true, 10,5%=false.
  const [recargoManualHabilitado, recargo105Habilitado] = await Promise.all([
    user.empresa_id ? isRecargoManualHabilitado(user.empresa_id) : false,
    user.empresa_id ? isRecargo105Habilitado(user.empresa_id) : false,
  ])

  return (
    <CajaView
      user={user}
      recargoManualHabilitado={recargoManualHabilitado}
      recargo105Habilitado={recargo105Habilitado}
    />
  )
}
