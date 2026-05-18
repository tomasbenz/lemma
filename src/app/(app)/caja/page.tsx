// src/app/(app)/caja/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  isRecargoManualHabilitado,
  isRecargo105Habilitado,
} from '@/lib/features'
import { obtenerTurnoActivoDeEmpresa } from '@/lib/queries/turnos'
import { CajaView } from './_components/caja-view'
import { PantallaSinTurno } from './_components/pantalla-sin-turno'

export const metadata = {
  title: 'Caja',
}

/**
 * Página de Caja.
 *
 * En el server cargamos sólo lo necesario para validar sesión, resolver
 * feature flags por empresa y conocer el estado del turno de caja. Los datos
 * del catálogo (productos + clientes) los carga CajaView en cliente via
 * /api/sync/catalog, con fallback a IndexedDB cuando no hay internet.
 *
 * Si no hay un turno abierto en la caja default de la empresa, se renderiza
 * PantallaSinTurno y la cajera/admin debe abrir un turno antes de operar.
 */
export default async function CajaPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  if (!user.empresa_id) {
    return <PantallaSinTurno user={user} motivo="sin_empresa" />
  }

  // Cargar en paralelo: feature flags + turno activo.
  const [recargoManualHabilitado, recargo105Habilitado, turnoActivo] =
    await Promise.all([
      isRecargoManualHabilitado(user.empresa_id),
      isRecargo105Habilitado(user.empresa_id),
      obtenerTurnoActivoDeEmpresa(user.empresa_id),
    ])

  if (!turnoActivo) {
    return <PantallaSinTurno user={user} motivo="sin_turno" />
  }

  return (
    <CajaView
      user={user}
      recargoManualHabilitado={recargoManualHabilitado}
      recargo105Habilitado={recargo105Habilitado}
      turnoActivo={turnoActivo}
    />
  )
}
