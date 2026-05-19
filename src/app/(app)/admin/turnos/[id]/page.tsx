// src/app/(app)/admin/turnos/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Info } from 'lucide-react'

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

function formatHora(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', {
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

  const nombreApertura =
    turno.usuario_apertura?.nombre_completo ??
    turno.usuario_apertura?.email ??
    '—'
  const nombreCierre =
    turno.usuario_cierre?.nombre_completo ??
    turno.usuario_cierre?.email ??
    '—'

  // Total cobrado = suma de TODOS los medios de pago del turno
  const totalCobrado = resumen.totales_por_medio_pago.reduce(
    (s, m) => s + m.monto,
    0
  )
  const ticketPromedio =
    resumen.cantidad_ventas > 0 ? totalCobrado / resumen.cantidad_ventas : null

  // Para el link a venta anulada: solo cuando hay exactamente 1
  const ventasAnuladas = ventas.filter((v) => v.estado === 'anulada')
  const ventaAnuladaUnica =
    resumen.cantidad_anulaciones === 1 && ventasAnuladas.length === 1
      ? ventasAnuladas[0]
      : null

  const mostrarCalculo = !abierto && turno.total_declarado !== null

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

        <Card className="p-4 md:p-6 space-y-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Resumen del turno
          </div>

          {/* Bloque 1 — KPIs */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
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
              <div className="text-2xl md:text-3xl font-bold font-numeric tabular-nums">
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

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Total cobrado</div>
              <div className="text-2xl md:text-3xl font-bold font-numeric tabular-nums">
                {formatARS(totalCobrado)}
              </div>
              <div className="text-xs text-muted-foreground font-numeric tabular-nums">
                Ticket promedio{' '}
                {ticketPromedio === null ? '—' : formatARS(ticketPromedio)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Ventas</div>
              <div className="text-2xl md:text-3xl font-bold font-numeric tabular-nums">
                {resumen.cantidad_ventas} cerradas
              </div>
              {resumen.cantidad_anulaciones > 0 && (
                <div className="text-xs text-muted-foreground">
                  {ventaAnuladaUnica ? (
                    <>
                      1 anulada (
                      <Link
                        href={`/admin/ventas/${ventaAnuladaUnica.id}`}
                        className="underline hover:text-foreground"
                      >
                        #{ventaAnuladaUnica.numero}
                      </Link>
                      )
                    </>
                  ) : (
                    <>
                      {resumen.cantidad_anulaciones} anulada
                      {resumen.cantidad_anulaciones === 1 ? '' : 's'}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bloque 2 — Datos del turno */}
          <div className="space-y-1.5 text-sm border-t pt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground w-20 shrink-0">
                Apertura
              </span>
              <span className="font-numeric tabular-nums">
                {formatHora(turno.abierto_at)}
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{nombreApertura}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-numeric tabular-nums">
                <span className="text-muted-foreground">Base </span>
                {formatARS(turno.base_inicial)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground w-20 shrink-0">
                Cierre
              </span>
              {abierto ? (
                <span className="text-muted-foreground">
                  El turno todavía está abierto.
                </span>
              ) : (
                <>
                  <span className="font-numeric tabular-nums">
                    {formatHora(turno.cerrado_at)}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span>{nombreCierre}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-numeric tabular-nums">
                    <span className="text-muted-foreground">Declarado </span>
                    {turno.total_declarado === null
                      ? '—'
                      : formatARS(turno.total_declarado)}
                  </span>
                </>
              )}
            </div>

            {turno.nota_apertura && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className="text-muted-foreground w-20 shrink-0">
                  Nota apertura
                </span>
                <span className="flex-1 min-w-0">{turno.nota_apertura}</span>
              </div>
            )}

            {turno.nota_cierre && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <span className="text-muted-foreground w-20 shrink-0">
                  Nota cierre
                </span>
                <span className="flex-1 min-w-0">{turno.nota_cierre}</span>
              </div>
            )}

            {turno.forzado_por_admin && turno.motivo_forzado && (
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1 pt-1">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Cierre forzado:</span>
                <span className="flex-1 min-w-0">{turno.motivo_forzado}</span>
              </div>
            )}
          </div>

          {/* Bloque 3 — Cálculo explícito */}
          {mostrarCalculo && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1 font-numeric tabular-nums">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">
                Cálculo
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
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-muted-foreground">Base</span>
                <span>{formatARS(turno.base_inicial)}</span>
                <span className="text-muted-foreground">+</span>
                <span className="text-muted-foreground">Efectivo en ventas</span>
                <span>{formatARS(resumen.total_efectivo_ventas)}</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-muted-foreground">Efectivo teórico</span>
                <span className="font-semibold">
                  {formatARS(resumen.total_teorico_efectivo)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-muted-foreground">Declarado</span>
                <span>{formatARS(turno.total_declarado ?? 0)}</span>
                <span className="text-muted-foreground">−</span>
                <span className="text-muted-foreground">Teórico</span>
                <span>{formatARS(resumen.total_teorico_efectivo)}</span>
                <span className="text-muted-foreground">=</span>
                <span className="font-semibold">
                  {resumen.diferencia === null
                    ? '—'
                    : `${resumen.diferencia > 0 ? '+' : ''}${formatARS(
                        resumen.diferencia
                      )}`}
                </span>
              </div>
            </div>
          )}

          {/* Bloque 4 — Totales por medio de pago */}
          {resumen.totales_por_medio_pago.length > 0 && (
            <div className="pt-4 border-t">
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
