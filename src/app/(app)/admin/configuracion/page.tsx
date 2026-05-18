import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import { ConfiguracionForm } from './_components/configuracion-form'

export const metadata = {
  title: 'Configuración',
}

export default async function ConfiguracionPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const config = await obtenerConfiguracion()

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Configuración
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Datos fiscales y de contacto de la empresa. Aparecen en las facturas.
          </p>
        </div>

        <ConfiguracionForm initialData={config} />
      </div>
    </div>
  )
} 