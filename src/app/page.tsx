import { redirect } from 'next/navigation'
import { getCurrentUser, getDefaultRoute } from '@/lib/auth/get-current-user'

/**
 * Raíz del sistema.
 *
 * - Si no hay sesión → redirige a /login
 * - Si hay sesión → redirige a la ruta default según rol
 *   (vendedor → /caja, admin → /admin)
 *
 * Esta página nunca se ve realmente, siempre redirige.
 */
export default async function HomePage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  redirect(getDefaultRoute(user.rol))
}