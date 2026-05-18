/**
 * Helpers de formateo de fechas en zona horaria Argentina (UTC-3).
 *
 * Argentina no aplica horario de verano desde 2009, así que UTC-3 es fijo.
 *
 * Por qué existen estos helpers:
 *   - AFIP exige `CbteFch` en formato YYYYMMDD interpretado en hora AR.
 *   - El PDF de la factura debe mostrar la misma fecha que el comprobante
 *     registrado en AFIP — si divergen, auditoría fiscal genera observación.
 *   - `toLocaleDateString('es-AR', ...)` en Node respeta la TZ del runtime,
 *     no la del locale. En Vercel runtime es UTC, así que devuelve el día UTC.
 *   - Para que ambos formatos partan del MISMO Date normalizado a TZ AR,
 *     centralizamos la lógica acá.
 *
 * Invariante mantenida por los dos formatters:
 *   formatearFechaYYYYMMDD(d) y formatearFechaDDMMYYYY(d) describen
 *   SIEMPRE el mismo día calendario en AR para cualquier Date d.
 */

const OFFSET_MINUTOS_AR = -3 * 60

type PartesFechaAr = {
  year: number
  month: number  // 1-12
  day: number    // 1-31
}

/**
 * Convierte una Date (instante absoluto) a sus componentes de día/mes/año
 * tal como se ven en Argentina.
 *
 * Truco: sumamos el offset AR al timestamp y leemos con getUTC* — así
 * obtenemos los componentes "como si fuera UTC pero en hora AR".
 */
function partesFechaAr(fecha: Date): PartesFechaAr {
  const fechaLocal = new Date(fecha.getTime() + OFFSET_MINUTOS_AR * 60 * 1000)
  return {
    year: fechaLocal.getUTCFullYear(),
    month: fechaLocal.getUTCMonth() + 1,
    day: fechaLocal.getUTCDate(),
  }
}

/**
 * Formatea a YYYYMMDD (sin separador). Es el formato que AFIP exige para
 * `CbteFch` en FECAESolicitar y para `generationTime` en el TRA WSAA.
 *
 * Ejemplo: 2026-05-14T02:00:00Z (= 23:00 AR del 13) → "20260513"
 */
export function formatearFechaYYYYMMDD(fecha: Date): string {
  const { year, month, day } = partesFechaAr(fecha)
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

/**
 * Formatea a DD/MM/YYYY (formato visual argentino). Es el formato que el
 * PDF de la factura imprime para "Fecha de emisión".
 *
 * Garantiza coherencia byte-a-byte con el día reportado a AFIP: si AFIP
 * recibió "20260513", el PDF muestra "13/05/2026".
 */
export function formatearFechaDDMMYYYY(fecha: Date): string {
  const { year, month, day } = partesFechaAr(fecha)
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}
