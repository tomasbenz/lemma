// src/app/(app)/caja/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { isRecargoManualHabilitado } from '@/lib/features'
import { CajaView } from './_components/caja-view'

export const metadata = {
  title: 'Caja',
}

/**
 * Página de Caja.
 *
 * En el server cargamos solamente el usuario para validar la sesión.
 * Los datos del catálogo (productos + clientes) los carga CajaView en cliente
 * via /api/sync/catalog, con fallback automático a IndexedDB cuando no hay
 * internet. Esto permite que la caja funcione offline si la vendedora ya
 * sincronizó al menos una vez con conexión.
 *
 * Trade-off: hay un loader breve (~200-500ms) en la primera carga vs el SSR
 * de antes. A cambio, ganamos modo offline y sincronización en tiempo real.
 */
export default async function CajaPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Feature flag: si la empresa no habilitó recargo manual, los toggles
  // (10,5%, recargo manual %, presets 30/50/100) quedan ocultos. Para
  // Lemma + Samu el default es false → flujo simple sin recargos.
  const recargoManualHabilitado = user.empresa_id
    ? await isRecargoManualHabilitado(user.empresa_id)
    : false

  return (
    <CajaView
      user={user}
      recargoManualHabilitado={recargoManualHabilitado}
    />
  )
}