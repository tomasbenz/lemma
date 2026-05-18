import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerCliente } from '@/lib/queries/clientes'
import { Button } from '@/components/ui/button'
import { ClienteForm } from '../../_components/cliente-form'
import { actualizarCliente } from './_actions/actualizar-cliente'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const cliente = await obtenerCliente(id)
  return {
    title: cliente ? `Editar · ${cliente.razon_social}` : 'Cliente no encontrado',
  }
}

export default async function EditarClientePage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { id } = await params
  const cliente = await obtenerCliente(id)
  if (!cliente) notFound()

  // Binding del id al action
  const onSubmit = async (formData: FormData) => {
    'use server'
    return actualizarCliente(id, formData)
  }

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
            <Link href={`/admin/clientes/${id}`}>
              <ArrowLeft className="size-4 mr-1" />
              Volver al detalle
            </Link>
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Editar cliente
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {cliente.razon_social}
          </p>
        </div>

        <ClienteForm
          initialData={cliente}
          onSubmit={onSubmit}
          submitLabel="Guardar cambios"
          redirectOnSuccess={`/admin/clientes/${id}`}
        />
      </div>
    </div>
  )
}