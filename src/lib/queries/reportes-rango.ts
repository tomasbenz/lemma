// Cálculo de rangos de fecha para Reportes. Módulo PURO (sin 'server-only')
// para poder testearlo con node:test. reportes.ts lo re-exporta.

export type PeriodoReporte =
  | 'hoy'
  | 'ayer'
  | 'semana_actual'
  | 'mes_actual'
  | 'mes_pasado'
  | 'anio_actual'
  | 'personalizado'

export type OpcionesReporte = {
  periodo: PeriodoReporte
  /** ISO YYYY-MM-DD. Solo se usa si periodo === 'personalizado'. */
  desde?: string | null
  /** ISO YYYY-MM-DD. Solo se usa si periodo === 'personalizado'. */
  hasta?: string | null
  /**
   * Si viene, todas las queries filtran por venta.turno_id = turnoId.
   * El rango de fechas se sigue calculando del `periodo`, pero el
   * caller (página) generalmente lo deriva del turno (abierto_at → cerrado_at).
   */
  turnoId?: string | null
}

function inicioDelDia(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function finDelDia(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

/**
 * Devuelve { desde, hasta } como Date locales según el periodo.
 *
 * Fin "inclusivo" (instante): para períodos en curso usamos `ahora`; para
 * períodos pasados, el fin del último día. La RPC nueva usa `< p_hasta` y la
 * vieja `<= p_hasta`: la diferencia en el instante de borde es despreciable.
 *
 * NOTA TZ: se usa la hora LOCAL del server (mismo patrón que dashboard.ts y la
 * versión previa). Si el server no corre en zona AR los bordes de día pueden
 * quedar corridos; `ventas_por_hora` sí usa AT TIME ZONE AR en SQL.
 *
 * Para 'personalizado' usa los strings ISO YYYY-MM-DD (si no vienen válidos,
 * cae a mes_actual para no romper).
 */
export function calcularRango(opts: OpcionesReporte): {
  desde: Date
  hasta: Date
} {
  const ahora = new Date()
  const hoyInicio = inicioDelDia(ahora)

  switch (opts.periodo) {
    case 'hoy':
      return { desde: hoyInicio, hasta: ahora }
    case 'ayer': {
      const ayer = new Date(hoyInicio)
      ayer.setDate(ayer.getDate() - 1)
      return { desde: ayer, hasta: finDelDia(ayer) }
    }
    case 'semana_actual': {
      // Lunes de esta semana (getDay: 0=domingo … 6=sábado).
      const lunes = new Date(hoyInicio)
      const offset = (lunes.getDay() + 6) % 7 // días desde el lunes
      lunes.setDate(lunes.getDate() - offset)
      return { desde: lunes, hasta: ahora }
    }
    case 'mes_actual': {
      const d = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
      d.setHours(0, 0, 0, 0)
      return { desde: d, hasta: ahora }
    }
    case 'mes_pasado': {
      const desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)
      desde.setHours(0, 0, 0, 0)
      // Último día del mes pasado = día 0 del mes actual.
      const finMes = new Date(ahora.getFullYear(), ahora.getMonth(), 0)
      return { desde, hasta: finDelDia(finMes) }
    }
    case 'anio_actual': {
      const d = new Date(ahora.getFullYear(), 0, 1)
      d.setHours(0, 0, 0, 0)
      return { desde: d, hasta: ahora }
    }
    case 'personalizado': {
      const re = /^\d{4}-\d{2}-\d{2}$/
      const desdeOk = opts.desde && re.test(opts.desde)
      const hastaOk = opts.hasta && re.test(opts.hasta)
      if (!desdeOk || !hastaOk) {
        return calcularRango({ periodo: 'mes_actual' })
      }
      return {
        desde: inicioDelDia(new Date(opts.desde + 'T00:00:00')),
        hasta: finDelDia(new Date(opts.hasta + 'T00:00:00')),
      }
    }
    default:
      return calcularRango({ periodo: 'mes_actual' })
  }
}
