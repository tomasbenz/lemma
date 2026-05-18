import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  MapPin,
  FileText,
  Receipt,
  Building2,
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerCliente } from '@/lib/queries/clientes'
import { labelCondIva } from '@/lib/queries/clientes-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { CambiarEstadoClienteButton } from '../_components/cambiar-estado-cliente-button'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const cliente = await obtenerCliente(id)
  return {
    title: cliente ? cliente.razon_social : 'Cliente no encontrado',
  }
}

export default async function ClienteDetallePage({
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

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/clientes">
              <ArrowLeft className="size-4 mr-1" />
              Volver a clientes
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {cliente.razon_social}
              </h1>
              {cliente.activo ? (
                <Badge
                  variant="outline"
                  className="text-xs text-success bg-success/10 border-success/40"
                >
                  <span className="size-1.5 rounded-full bg-success mr-1.5" />
                  Activo
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Inactivo
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {labelCondIva(cliente.cond_iva)}
              </Badge>
              {cliente.cuit && (
                <span className="font-numeric">CUIT {cliente.cuit}</span>
              )}
            </p>
          </div>

          <div className="flex gap-2 shrink-0">
            <CambiarEstadoClienteButton
              clienteId={cliente.id}
              razonSocial={cliente.razon_social}
              activo={cliente.activo}
            />
            <Button asChild>
              <Link href={`/admin/clientes/${cliente.id}/editar`}>
                <Edit className="size-4 mr-2" />
                Editar
              </Link>
            </Button>
          </div>
        </div>

        {/* Contacto + Dirección */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataRow
                icon={<Mail className="size-4 text-muted-foreground" />}
                label="Email"
                valor={cliente.email}
              />
              <DataRow
                icon={<Phone className="size-4 text-muted-foreground" />}
                label="Teléfono"
                valor={cliente.telefono}
                esNumerico
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dirección</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataRow
                icon={<MapPin className="size-4 text-muted-foreground" />}
                label="Domicilio"
                valor={cliente.domicilio}
              />
              <DataRow
                icon={<Building2 className="size-4 text-muted-foreground" />}
                label="Localidad / Provincia"
                valor={
                  [cliente.localidad, cliente.provincia]
                    .filter(Boolean)
                    .join(', ') || null
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Notas */}
        {cliente.notas && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                Notas internas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {cliente.notas}
              </p>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Historial (placeholder para futuro) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="size-4 text-muted-foreground" />
              Historial de ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Próximamente: listado de ventas asociadas a este cliente.
            </p>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="mt-3"
            >
              <Link href={`/admin/ventas?clienteId=${cliente.id}`}>
                Ver ventas de este cliente →
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DataRow({
  icon,
  label,
  valor,
  esNumerico,
}: {
  icon: React.ReactNode
  label: string
  valor: string | null
  esNumerico?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        {valor ? (
          <p className={cn('text-sm', esNumerico && 'font-numeric')}>{valor}</p>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">No especificado</p>
        )}
      </div>
    </div>
  )
}