// src/app/(app)/admin/turnos/_components/turnos-listado-agrupado.tsx
import { formatARS } from '@/lib/format'
import { labelMedioPago, colorMedioPago } from '@/lib/medios-pago'
import type { ResumenDiaTurnos } from '@/lib/queries/turnos'
import { TurnosTabla } from './turnos-tabla'

type Props = {
  grupos: ResumenDiaTurnos[]
}

function etiquetaDia(yyyyMmDd: string): string {
  const hoy = new Date().toISOString().slice(0, 10)
  if (yyyyMmDd === hoy) return 'Hoy'

  const ayerDate = new Date()
  ayerDate.setDate(ayerDate.getDate() - 1)
  const ayer = ayerDate.toISOString().slice(0, 10)
  if (yyyyMmDd === ayer) return 'Ayer'

  const d = new Date(yyyyMmDd + 'T00:00:00')
  return d.toLocaleDateString('es-AR', {
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
        <section key={g.dia}>
          <div className="px-4 py-3 space-y-2 bg-muted/20">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {etiquetaDia(g.dia)}
              </h2>
              <div className="text-sm text-muted-foreground font-numeric tabular-nums">
                {g.cantidad_turnos} turno{g.cantidad_turnos === 1 ? '' : 's'}
                {' · '}
                Total cobrado{' '}
                <span className="text-foreground font-semibold">
                  {formatARS(g.total_cobrado)}
                </span>
                {g.declarado_total > 0 && (
                  <>
                    {' · '}
                    Declarado {formatARS(g.declarado_total)}
                  </>
                )}
                {' · '}
                Diferencia{' '}
                <span className="text-foreground font-semibold">
                  {g.diferencia_total > 0 ? '+' : ''}
                  {formatARS(g.diferencia_total)}
                </span>
              </div>
            </div>

            {g.por_medio.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {g.por_medio.map((m) => {
                  const pct =
                    g.total_cobrado > 0 ? (m.monto / g.total_cobrado) * 100 : 0
                  return (
                    <div
                      key={m.medio}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        className={`size-2 rounded-full ${colorMedioPago(m.medio)}`}
                      />
                      <span className="text-muted-foreground">
                        {labelMedioPago(m.medio)}
                      </span>
                      <span className="font-numeric tabular-nums">
                        {formatARS(m.monto)}
                      </span>
                      <span className="text-muted-foreground">
                        ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <TurnosTabla rows={g.turnos} />
        </section>
      ))}
    </div>
  )
}
