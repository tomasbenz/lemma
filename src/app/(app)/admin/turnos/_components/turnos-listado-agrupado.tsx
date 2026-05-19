// src/app/(app)/admin/turnos/_components/turnos-listado-agrupado.tsx
import { formatARS } from '@/lib/format'
import { labelMedioPago, colorMedioPago } from '@/lib/medios-pago'
import type { ResumenDiaTurnos } from '@/lib/queries/turnos'
import { TurnosTabla } from './turnos-tabla'

type Props = {
  grupos: ResumenDiaTurnos[]
}

function etiquetaDia(yyyyMmDd: string): string {
  const hoy = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  if (yyyyMmDd === hoy) return 'Hoy'

  const ayerDate = new Date()
  ayerDate.setDate(ayerDate.getDate() - 1)
  const ayer = ayerDate.toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  if (yyyyMmDd === ayer) return 'Ayer'

  const d = new Date(yyyyMmDd + 'T00:00:00')
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function TurnosListadoAgrupado({ grupos }: Props) {
  if (grupos.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No se encontraron turnos.
      </div>
    )
  }

  return (
    <div className="divide-y">
      {grupos.map((g) => (
        <section key={g.dia} className="py-6 px-4 md:px-6 first:pt-4">
          <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">
              {etiquetaDia(g.dia)}
            </h2>
            <p className="text-xs text-muted-foreground font-numeric tabular-nums">
              {g.cantidad_turnos} turno{g.cantidad_turnos === 1 ? '' : 's'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Total cobrado</p>
              <p className="text-xl font-bold font-numeric tabular-nums">
                {formatARS(g.total_cobrado)}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Declarado</p>
              <p className="text-xl font-bold font-numeric tabular-nums">
                {g.tiene_turno_abierto || g.declarado_total === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatARS(g.declarado_total)
                )}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Diferencia</p>
              <p className="text-xl font-bold font-numeric tabular-nums">
                {g.tiene_turno_abierto ? (
                  <span className="text-muted-foreground">Pendiente</span>
                ) : (
                  <>
                    {g.diferencia_total > 0 ? '+' : ''}
                    {formatARS(g.diferencia_total)}
                  </>
                )}
              </p>
            </div>
          </div>

          {g.por_medio.length > 0 && (
            <div className="rounded-md border bg-muted/20 px-3 py-2.5 mb-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
                Por medio de pago
              </p>
              <div className="space-y-1.5">
                {g.por_medio.map((m) => {
                  const pct =
                    g.total_cobrado > 0
                      ? (m.monto / g.total_cobrado) * 100
                      : 0
                  const mostrarPct = g.por_medio.length > 1
                  return (
                    <div
                      key={m.medio}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`size-2.5 rounded-full shrink-0 ${colorMedioPago(m.medio)}`}
                        />
                        <span className="truncate">
                          {labelMedioPago(m.medio)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-numeric tabular-nums shrink-0">
                        <span className="font-semibold">
                          {formatARS(m.monto)}
                        </span>
                        {mostrarPct && (
                          <span className="text-xs text-muted-foreground w-10 text-right">
                            {pct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <TurnosTabla rows={g.turnos} />
        </section>
      ))}
    </div>
  )
}
