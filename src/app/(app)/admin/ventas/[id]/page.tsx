// src/app/(app)/admin/ventas/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  User,
  Banknote,
  ArrowRightLeft,
  Building2,
  QrCode,
  MoreHorizontal,
  Inbox,
  Pencil,
} from 'lucide-react'
import { obtenerFacturaAfip } from '@/lib/queries/facturas-afip'
import { FacturaAfipCard } from '../_components/factura-afip-card'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerVenta } from '@/lib/queries/ventas'
import { listarHistorialVenta } from '@/lib/queries/historial-venta'
import { HistorialCambios } from '@/components/historial-cambios/historial-cambios'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatARS, formatNumber } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import { cn } from '@/lib/utils'
import { AnularVentaButton } from '../_components/anular-venta-button'
import { descomponerFactura } from '@/lib/afip/calculos'
import type { Database } from '@/types/database'

type Params = Promise<{ id: string }>

type TipoFactura = Database['public']['Enums']['tipo_factura']
type Estado = 'abierta' | 'guardada' | 'cerrada' | 'anulada'
type MedioPago = 'efectivo' | 'transferencia' | 'deposito' | 'mercadopago_qr' | 'otro'

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const venta = await obtenerVenta(id)
  return {
    title: venta ? `Venta #${venta.numero}` : 'Venta no encontrada',
  }
}

export default async function VentaDetallePage({
  params,
}: {
  params: Params
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')
  if (!user.empresa_id) notFound()

  const { id } = await params
  const [venta, factura, eventos] = await Promise.all([
    obtenerVenta(id),
    obtenerFacturaAfip(id, user.empresa_id),
    listarHistorialVenta(id, user.empresa_id),
  ])

  if (!venta) notFound()

  const usuarioRaw = venta.usuario as
    | { id: string; nombre_completo: string | null; email: string }
    | Array<{ id: string; nombre_completo: string | null; email: string }>
    | null
  const usuario = Array.isArray(usuarioRaw) ? usuarioRaw[0] ?? null : usuarioRaw

  const clienteRaw = venta.cliente as
    | {
        id: string
        razon_social: string
        cuit: string | null
        cond_iva: string
      }
    | Array<{
        id: string
        razon_social: string
        cuit: string | null
        cond_iva: string
      }>
    | null
  const cliente = Array.isArray(clienteRaw) ? clienteRaw[0] ?? null : clienteRaw

  const items = (venta.items_venta ?? []) as Array<{
    id: string
    producto_nombre: string
    producto_sku: string
    variante_sku: string
    variante_atributos: Record<string, string> | null
    cantidad: number
    precio_unitario_neto: number
    subtotal_neto: number
  }>

  const medios = (venta.medios_pago_venta ?? []) as Array<{
    id: string
    medio: MedioPago
    monto: number
    referencia: string | null
  }>

  // Bajo el modelo nuevo: venta.total ya es el total final cobrado (precios
  // netos + recargo 10,5% opcional). El IVA solo aparece descompuesto cuando
  // hay factura emitida, calculado a partir de monto_facturado.
  const baseConDescuento =
    Math.round((venta.subtotal_neto - venta.descuento_total) * 100) / 100
  const recargoMonto = venta.recargo_factura_completa
    ? Math.round((venta.total - baseConDescuento) * 100) / 100
    : 0
  const recargoManualMonto =
    venta.recargo_porcentaje_manual !== null
      ? Math.round((venta.total - baseConDescuento) * 100) / 100
      : 0
  const desgloseFacturado =
    venta.tipo_factura !== 'sin_factura'
      ? descomponerFactura(
          venta.monto_facturado,
          venta.tipo_factura as 'factura_a' | 'factura_b' | 'factura_c',
        )
      : null

  const esPedidoPendiente = venta.estado === 'guardada'

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/ventas">
              <ArrowLeft className="size-4 mr-1" />
              Volver a ventas
            </Link>
          </Button>
        </div>

        {/* Banner: si est  guardada, redirigir al pedido para finalizarla */}
        {esPedidoPendiente && (
          <Card className="border-info/40 bg-info/5 enter-up">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <div className="size-9 rounded-md bg-info/15 flex items-center justify-center shrink-0">
                <Inbox className="size-4 text-info" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  Esta venta es un pedido pendiente
                </p>
                <p className="text-xs text-muted-foreground">
                  Está guardada por una vendedora pero todavía no se cobró.
                  Finalizala desde el detalle del pedido.
                </p>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <Link href={`/admin/pedidos/${venta.id}`}>
                  Ir al pedido
                  <ArrowRight className="size-3.5 ml-1.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-numeric">
                Venta #{venta.numero}
              </h1>
              <BadgeEstado estado={venta.estado as Estado} />
              <BadgeFactura tipo={venta.tipo_factura} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              <FechaLarga fecha={venta.created_at} />
              {venta.closed_at && venta.closed_at !== venta.created_at && (
                <>
                  <span className="mx-1.5">·</span>
                  Cerrada <FechaLarga fecha={venta.closed_at} />
                </>
              )}
            </p>
          </div>

          {venta.estado === 'cerrada' && (user.rol === 'admin' || user.rol === 'superadmin') && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/ventas/${venta.id}/editar`}>
                  <Pencil className="size-4 mr-1.5" />
                  Editar venta
                </Link>
              </Button>
              <AnularVentaButton
                ventaId={venta.id}
                numero={venta.numero}
                facturaAprobadaActiva={
                  factura?.original.estado === 'aprobada' &&
                  factura.original.numero_comprobante !== null
                    ? {
                        tipo: venta.tipo_factura === 'factura_a' ? 'A' : 'B',
                        comprobante: `${factura.original.punto_venta
                          .toString()
                          .padStart(4, '0')}-${factura.original.numero_comprobante
                          .toString()
                          .padStart(8, '0')}`,
                      }
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Grid: datos + totales */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Datos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DataRow
                  icon={<User className="size-4 text-muted-foreground" />}
                  label="Vendedor"
                >
                  <span className="text-sm">
                    {usuario?.nombre_completo ?? usuario?.email ?? '—'}
                  </span>
                  {usuario?.email && usuario?.nombre_completo && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      · {usuario.email}
                    </span>
                  )}
                </DataRow>

                <DataRow
                  icon={<FileText className="size-4 text-muted-foreground" />}
                  label="Cliente"
                >
                  {cliente ? (
                    <div className="text-sm">
                      <p className="font-medium">{cliente.razon_social}</p>
                      <p className="text-xs text-muted-foreground">
                        {cliente.cuit && `CUIT ${cliente.cuit} · `}
                        {cliente.cond_iva}
                      </p>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">
                      Consumidor final
                    </span>
                  )}
                </DataRow>

                {venta.tipo_factura !== 'sin_factura' && (
                  <DataRow
                    icon={
                      <FileText className="size-4 text-muted-foreground" />
                    }
                    label="Monto facturado"
                  >
                    <span className="text-sm font-numeric">
                      {formatARS(venta.monto_facturado)}
                    </span>
                    {Math.abs(venta.monto_facturado - venta.total) > 0.02 && (
                      <span className="text-xs text-muted-foreground ml-1.5">
                        (distinto del total cobrado)
                      </span>
                    )}
                  </DataRow>
                )}

                {venta.nota_interna && (
                  <DataRow
                    icon={
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    }
                    label="Nota interna"
                  >
                    <p className="text-sm whitespace-pre-wrap">
                      {venta.nota_interna}
                    </p>
                  </DataRow>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal neto</span>
                <span className="font-numeric">
                  {formatARS(venta.subtotal_neto)}
                </span>
              </div>
              {venta.descuento_total > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Descuento</span>
                  <span className="font-numeric">
                    − {formatARS(venta.descuento_total)}
                  </span>
                </div>
              )}
              {venta.recargo_factura_completa && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Recargo 10,5%</span>
                  <span className="font-numeric">
                    + {formatARS(recargoMonto)}
                  </span>
                </div>
              )}
              {venta.recargo_porcentaje_manual !== null && (
                <div className="space-y-0.5">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Recargo {venta.recargo_porcentaje_manual}% manual</span>
                    <span className="font-numeric">
                      + {formatARS(recargoManualMonto)}
                    </span>
                  </div>
                  {venta.recargo_motivo && (
                    <p className="text-[10px] text-muted-foreground italic pl-0.5">
                      {venta.recargo_motivo}
                    </p>
                  )}
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>Total cobrado</span>
                <span className="font-numeric">{formatARS(venta.total)}</span>
              </div>

              {desgloseFacturado && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground uppercase tracking-wide pt-1">
                    Facturado
                  </p>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Neto facturado</span>
                    <span className="font-numeric">
                      {formatARS(desgloseFacturado.netoGravado)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>IVA 21% facturado</span>
                    <span className="font-numeric">
                      {formatARS(desgloseFacturado.iva)}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Factura AFIP */}
        <FacturaAfipCard
          ventaId={venta.id}
          tipoFactura={
            venta.tipo_factura as
              | 'sin_factura'
              | 'factura_a'
              | 'factura_b'
              | 'factura_c'
          }
          factura={factura}
          ventaAnulada={venta.estado === 'anulada'}
        />

        {/* Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Items ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-center">Cant.</TableHead>
                  <TableHead className="text-right">
                    Precio unit. neto
                  </TableHead>
                  <TableHead className="text-right">Subtotal neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const variante = formatAtributos(i.variante_atributos) || '—'
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm font-medium">
                        {i.producto_nombre}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {variante}
                      </TableCell>
                      <TableCell className="text-xs font-numeric text-muted-foreground">
                        {i.variante_sku}
                      </TableCell>
                      <TableCell className="text-center font-numeric">
                        {formatNumber(i.cantidad)}
                      </TableCell>
                      <TableCell className="text-right font-numeric">
                        {formatARS(i.precio_unitario_neto)}
                      </TableCell>
                      <TableCell className="text-right font-numeric font-medium">
                        {formatARS(i.subtotal_neto)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Medios de pago */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Medios de pago ({medios.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {medios.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-md border bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <MedioPagoIcon medio={m.medio} />
                    <div>
                      <p className="text-sm font-medium">
                        {labelMedioPago(m.medio)}
                      </p>
                      {m.referencia && (
                        <p className="text-xs text-muted-foreground font-numeric">
                          Ref: {m.referencia}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="font-numeric font-semibold">
                    {formatARS(m.monto)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Historial de cambios */}
        <HistorialCambios eventos={eventos} />
      </div>
    </div>
  )
}

// ============ Sub-componentes ============

function DataRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <div>{children}</div>
      </div>
    </div>
  )
}

function FechaLarga({ fecha }: { fecha: string }) {
  const d = new Date(fecha)
  const str = d.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return <span className="font-numeric">{str}</span>
}

function BadgeFactura({ tipo }: { tipo: TipoFactura }) {
  const map: Record<TipoFactura, { label: string; className: string }> = {
    sin_factura: {
      label: 'Sin factura',
      className: 'text-muted-foreground',
    },
    factura_a: {
      label: 'Factura A',
      className: 'text-primary border-primary/40 bg-primary/10',
    },
    factura_b: {
      label: 'Factura B',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
    factura_c: {
      // BACKCOMPAT: ventas históricas con factura_c se mostraban como
      // "Factura B" porque internamente se emitían como B. Mantener
      // label para no romper display histórico. Código nuevo persiste
      // factura_b directo.
      label: 'Factura B',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
    nota_credito_a: {
      label: 'NC A',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
    nota_credito_b: {
      label: 'NC B',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
    nota_debito_a: {
      label: 'ND A',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
    nota_debito_b: {
      label: 'ND B',
      className: 'text-foreground border-foreground/30 bg-muted',
    },
  }
  // Fallback defensivo: si llega un valor fuera del map (ej. un
  // nuevo tipo agregado al enum DB que aún no contemplamos acá),
  // renderizar el string raw en gris en lugar de crashear.
  const { label, className } = map[tipo] ?? {
    label: tipo,
    className: 'text-muted-foreground',
  }
  return (
    <Badge variant="outline" className={cn('text-xs', className)}>
      {label}
    </Badge>
  )
}

function BadgeEstado({ estado }: { estado: Estado }) {
  const map = {
    cerrada: {
      label: 'Cerrada',
      className: 'text-success bg-success/10 border-success/40',
      dot: 'bg-success',
    },
    anulada: {
      label: 'Anulada',
      className: 'text-destructive bg-destructive/10 border-destructive/40',
      dot: 'bg-destructive',
    },
    abierta: {
      label: 'Abierta',
      className: 'text-warning bg-warning/10 border-warning/40',
      dot: 'bg-warning',
    },
    guardada: {
      label: 'Guardada',
      className: 'text-info bg-info/10 border-info/40',
      dot: 'bg-info',
    },
  }
  const { label, className, dot } = map[estado]
  return (
    <Badge variant="outline" className={cn('text-xs', className)}>
      <span className={cn('size-1.5 rounded-full mr-1.5', dot)} />
      {label}
    </Badge>
  )
}

function MedioPagoIcon({ medio }: { medio: MedioPago }) {
  const iconClass = 'size-4 text-muted-foreground'
  const icons: Record<MedioPago, React.ReactNode> = {
    efectivo: <Banknote className={iconClass} />,
    transferencia: <ArrowRightLeft className={iconClass} />,
    deposito: <Building2 className={iconClass} />,
    mercadopago_qr: <QrCode className={iconClass} />,
    otro: <MoreHorizontal className={iconClass} />,
  }
  return (
    <div className="size-9 rounded-md bg-muted flex items-center justify-center shrink-0">
      {icons[medio]}
    </div>
  )
}

function labelMedioPago(medio: MedioPago): string {
  const labels: Record<MedioPago, string> = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    deposito: 'Depósito',
    mercadopago_qr: 'Mercado Pago QR',
    otro: 'Otro',
  }
  return labels[medio]
}