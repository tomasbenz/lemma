// src/app/(app)/admin/turnos/_components/turnos-tabla.tsx
import Link from 'next/link'
import { ChevronRight, AlertTriangle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatARS } from '@/lib/format'
import type { TurnoRow } from '@/lib/queries/turnos'

type Props = {
  rows: TurnoRow[]
}

function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function nombreUsuario(
  u: TurnoRow['usuario_apertura'] | TurnoRow['usuario_cierre']
): string {
  if (!u) return '—'
  return u.nombre_completo ?? u.email
}

export function TurnosTabla({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No se encontraron turnos.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto no-scrollbar">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-4 py-2.5">Apertura</th>
            <th className="text-left font-medium px-4 py-2.5">Cierre</th>
            <th className="text-left font-medium px-4 py-2.5">Caja</th>
            <th className="text-left font-medium px-4 py-2.5">Por</th>
            <th className="text-right font-medium px-4 py-2.5">Base</th>
            <th className="text-right font-medium px-4 py-2.5">Declarado</th>
            <th className="text-right font-medium px-4 py-2.5">Diferencia</th>
            <th className="text-left font-medium px-4 py-2.5">Estado</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const abierto = r.cerrado_at === null
            const diferencia = r.diferencia
            return (
              <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-numeric tabular-nums">
                  {formatFecha(r.abierto_at)}
                </td>
                <td className="px-4 py-2.5 font-numeric tabular-nums text-muted-foreground">
                  {formatFecha(r.cerrado_at)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.caja_nombre ?? '—'}</div>
                  {r.sucursal_nombre && (
                    <div className="text-xs text-muted-foreground">
                      {r.sucursal_nombre}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div>{nombreUsuario(r.usuario_apertura)}</div>
                  {r.usuario_cierre && (
                    <div className="text-xs text-muted-foreground">
                      cierre: {nombreUsuario(r.usuario_cierre)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-numeric tabular-nums">
                  {formatARS(r.base_inicial)}
                </td>
                <td className="px-4 py-2.5 text-right font-numeric tabular-nums">
                  {r.total_declarado === null
                    ? '—'
                    : formatARS(r.total_declarado)}
                </td>
                <td className="px-4 py-2.5 text-right font-numeric tabular-nums">
                  {diferencia === null ? (
                    '—'
                  ) : (
                    <span
                      className={
                        Math.abs(diferencia) < 0.01
                          ? 'text-muted-foreground'
                          : 'font-semibold'
                      }
                    >
                      {diferencia > 0 ? '+' : ''}
                      {formatARS(diferencia)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {abierto ? (
                    <Badge variant="secondary">Abierto</Badge>
                  ) : r.forzado_por_admin ? (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="size-3" />
                      Forzado
                    </Badge>
                  ) : (
                    <Badge variant="outline">Cerrado</Badge>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <Link
                    href={`/admin/turnos/${r.id}`}
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label="Ver detalle"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
