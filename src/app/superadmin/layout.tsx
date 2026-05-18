// src/app/superadmin/layout.tsx
//
// Layout independiente para el panel de superadmin.
// NO usa el sidebar ni topbar de la app de cliente — es una vista distinta.

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export const metadata = {
  title: 'Panel Superadmin · Lemma',
}

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  if (user.rol !== 'superadmin') {
    redirect('/admin')
  }

  return <>{children}</>
}