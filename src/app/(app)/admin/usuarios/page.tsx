// src/app/(app)/admin/usuarios/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listarUsuarios } from '@/lib/queries/usuarios'
import { UsuariosView } from './_components/usuarios-view'

export const metadata = {
  title: 'Usuarios',
}

export default async function UsuariosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const usuarios = await listarUsuarios()

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión de admins y vendedores
          </p>
        </div>

        <UsuariosView usuarios={usuarios} callerId={user.id} callerRol={user.rol} />
      </div>
    </div>
  )
}