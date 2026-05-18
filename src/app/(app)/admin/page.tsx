// src/app/(app)/admin/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerDashboardStats } from '@/lib/queries/dashboard'
import { DashboardView } from './_components/dashboard-view'

export const metadata = {
  title: 'Panel',
}

export default async function AdminPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const stats = await obtenerDashboardStats()

  return <DashboardView user={user} stats={stats} />
}