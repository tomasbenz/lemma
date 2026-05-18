import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { Button } from '@/components/ui/button'
import { ClienteForm } from '../_components/cliente-form'
import { crearCliente } from '../_actions/crear-cliente'

export const metadata = {
  title: 'Nuevo cliente',
}

export default async function NuevoClientePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
            <Link href="/admin/clientes">
              <ArrowLeft className="size-4 mr-1" />
              Volver a clientes
            </Link>
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Nuevo cliente
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cargá los datos del cliente. Solo razón social y condición IVA son obligatorios.
          </p>
        </div>

        <ClienteForm onSubmit={crearCliente} submitLabel="Crear cliente" />
      </div>
    </div>
  )
}