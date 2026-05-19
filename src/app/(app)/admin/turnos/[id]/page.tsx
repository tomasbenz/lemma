// src/app/(app)/admin/turnos/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  AlertTriangle,
  Clock,
  Info,
  LockKeyhole,
  User,
} from 'lucide-react'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { obtenerTurno, listarVentasDeTurno } from '@/lib/queries/turnos'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatARS } from '@/lib/format'
import { ForzarCierreButton } from '../_components/forzar-cierre-button'

const medioLabel: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  tarjeta_credito: 'Tarjeta crédito',
  tarjeta_debito: 'Tarjeta débito',
  cheque: 'Cheque',
  mercadopago: 'Mercado Pago',
  mercadopago_qr: 'Mercado Pago QR',
  otro: 'Otro',
}

const estadoVentaLabel: Record<string, string> = {
  cerrada: 'Cerrada',
  anulada: 'Anulada',
  guardada: 'Pedido',
  abierta: 'Abierta',
}

function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default async function TurnoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.rol === 'vendedor') redirect('/caja')

  const { id } = await params

  const [turnoData, ventas] = await Promise.all([
    obtenerTurno(id),
    listarVentasDeTurno(id),
  ])

  if (!turnoData) notFound()

  const { turno, resumen } = turnoData
  const abierto = turno.cerrado_at === null
  const puedeForzar =
    abierto && (user.rol === 'admin' || user.rol === 'superadmin')

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/admin/turnos">
                <ArrowLeft className="size-4" />
                Turnos
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Turno {turno.caja_nombre ?? ''}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {formatFecha(turno.abierto_at)}
                {turno.cerrado_at && ` → ${formatFecha(turno.cerrado_at)}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {abierto ? (
              <Badge variant="secondary">Abierto</Badge>
            ) : turno.forzado_por_admin ? (
              <Badge variant="outline" className="gap-1">
                <AlertTriangle className="size-3" />
                Cerrado (forzado)
              </Badge>
            ) : (
              <Badge variant="outline">Cerrado</Badge>
            )}
            {puedeForzar && <ForzarCierreButton turnoId={turno.id} />}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Apertura
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="size-3.5 text-muted-foreground" />
                {formatFecha(turno.abierto_at)}
              </div>
              <div className="flex items-center gap-2">
                <User className="size-3.5 text-muted-foreground" />
                {turno.usuario_apertura?.nombre_completo ??
                  turno.usuario_apertura?.email ??
                  '—'}
              </div>
              <div className="flex items-center gap-2 font-numeric tabular-nums">
                <span className="text-muted-foreground">Base:</span>
                {formatARS(turno.base_inicial)}
              </div>
              {turno.nota_apertura && (
                <p className="text-xs text-muted-foreground pt-1">
                  {turno.nota_apertura}
                </p>
              )}
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Cierre
            </div>
            {abierto ? (
              <p className="text-sm text-muted-foreground">
                El turno todavía está abierto.
              </p>
            ) : (
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <LockKeyhole className="size-3.5 text-muted-foreground" />
                  {formatFecha(turno.cerrado_at)}
                </div>
                <div className="flex items-center gap-2">
                  <User className="size-3.5 text-muted-foreground" />
                  {turno.usuario_cierre?.nombre_completo ??
                    turno.usuario_cierre?.email ??
                    '—'}
                </div>
                <div className="flex items-center gap-2 font-numeric tabular-nums">
                  <span className="text-muted-foreground">Declarado:</span>
                  {turno.total_declarado === null
                    ? '—'
                    : formatARS(turno.total_declarado)}
                </div>
                {turno.forzado_por_admin && turno.motivo_forzado && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Motivo: {turno.motivo_forzado}
                  </p>
                )}
                {turno.nota_cierre && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {turno.nota_cierre}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Resumen
          </div>
          <div className="grid gap-3 sm:grid-cols-4 text-sm font-numeric tabular-nums">
            <div className="space-y-0.5">
              <div className="text-muted-foreground text-xs">Ventas</div>
              <div className="font-semibold">
                {resumen.cantidad_ventas}
                {resumen.cantidad_anulaciones > 0 && (
                  <span className="text-muted-foreground ml-1 font-normal text-xs">
                    ({resumen.cantidad_anulaciones} anuladas)
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground text-xs">
                Efectivo cobrado en ventas
              </div>
              <div className="font-semibold">
                {formatARS(resumen.total_efectivo_ventas)}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                Efectivo teórico en caja
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Qué es el efectivo teórico"
                    >
                      <Info className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Lo que debería haber en efectivo físico en la caja al
                    cierre: base inicial + cobros en efectivo del turno. No
                    incluye transferencias ni tarjetas porque esa plata no
                    está en la caja.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="font-semibold">
                {formatARS(resumen.total_teorico_efectivo)}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground text-xs flex items-center gap-1">
                Diferencia (declarado − teórico)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Qué significa la diferencia"
                    >
                      <Info className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Positiva: hay más efectivo del esperado.
                    <br />
                    Negativa: falta efectivo.
                    <br />
                    Cero: cuadra exacto.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="font-semibold">
                {resumen.diferencia === null ? (
                  '—'
                ) : (
                  <>
                    {resumen.diferencia > 0 ? '+' : ''}
                    {formatARS(resumen.diferencia)}
                  </>
                )}
              </div>
            </div>
          </div>

          {resumen.totales_por_medio_pago.length > 0 && (
            <div className="pt-2 border-t">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
                Totales por medio de pago
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2 text-sm font-numeric tabular-nums">
                {resumen.totales_por_medio_pago.map((m) => (
                  <div key={m.medio} className="flex justify-between">
                    <span>
                      {medioLabel[m.medio] ?? m.medio}
                      <span className="text-muted-foreground text-xs ml-1">
                        ({m.cantidad})
                      </span>
                    </span>
                    <span>{formatARS(m.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Ventas del turno
          </div>
          {ventas.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Todavía no hay ventas en este turno.
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">N°</th>
                    <th className="text-left font-medium px-4 py-2.5">Fecha</th>
                    <th className="text-left font-medium px-4 py-2.5">
                      Estado
                    </th>
                    <th className="text-left font-medium px-4 py-2.5">
                      Vendedora
                    </th>
                    <th className="text-left font-medium px-4 py-2.5">
                      Cliente
                    </th>
                    <th className="text-right font-medium px-4 py-2.5">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ventas.map((v) => (
                    <tr
                      key={v.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-numeric tabular-nums">
                        <Link
                          href={`/admin/ventas/${v.id}`}
                          className="hover:underline"
                        >
                          #{v.numero}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 font-numeric tabular-nums text-muted-foreground">
                        {formatFecha(v.closed_at ?? v.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            v.estado === 'anulada' ? 'outline' : 'secondary'
                          }
                        >
                          {estadoVentaLabel[v.estado] ?? v.estado}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {v.vendedor_nombre ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {v.cliente_nombre ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-numeric tabular-nums">
                        {formatARS(v.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
