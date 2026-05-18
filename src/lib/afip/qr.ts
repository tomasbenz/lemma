/**
 * Helper puro para armar el QR de factura electrónica AFIP/ARCA.
 *
 * Spec oficial: https://www.afip.gob.ar/fe/qr/ (RG 4892/2020).
 * El QR debe codificar la URL del verificador ARCA con el JSON del
 * comprobante en base64. Campos numéricos en el JSON deben ir SIN comillas.
 *
 * Función pura, sin side-effects, sin DB, sin red. Testeable directo.
 *
 * El orden de las claves del JSON es IDÉNTICO al ejemplo oficial AFIP:
 *   ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz,
 *   tipoDocRec, nroDocRec, tipoCodAut, codAut.
 * Esto garantiza que el base64 generado matchee byte-a-byte el del
 * verificador cuando los datos coincidan.
 */

const URL_VERIFICADOR_AFIP = 'https://www.afip.gob.ar/fe/qr/?p='

export type DatosQrAfip = {
  /** CUIT emisor con o sin guiones; se limpian adentro y se valida numérico. */
  cuitEmisor: string
  /** Fecha del comprobante en ISO 8601 (ej '2026-05-07T10:00:00Z' o '2026-05-07'). */
  fecha: string
  puntoVenta: number
  /**
   * Código AFIP de tipo de comprobante. Soportados acá:
   * - 1 = Factura A
   * - 6 = Factura B
   * Para futuras extensiones (NC/ND), ampliar la unión.
   */
  tipoCmp: 1 | 6
  nroCmp: number
  /** Monto total facturado, se redondea adentro a 2 decimales. */
  importe: number
  /** CUIT receptor con o sin guiones, o null si CF anónimo. */
  cuitReceptor: string | null
  /** CAE devuelto por AFIP, debe ser numérico parseable (típicamente 14 dígitos). */
  cae: string
}

/**
 * Arma la URL del verificador ARCA para incrustar en el QR.
 *
 * @throws Error si el CUIT del emisor o el CAE no son numéricos parseables.
 *         Si el CUIT del receptor existe pero no parsea, lo trata como
 *         CF anónimo (nroDocRec=0) en lugar de fallar opaco.
 */
export function armarQrUrl(datos: DatosQrAfip): string {
  const cuitEmisor = parseInt(datos.cuitEmisor.replace(/-/g, ''), 10)
  if (Number.isNaN(cuitEmisor)) {
    throw new Error(`CUIT del emisor inválido en config: '${datos.cuitEmisor}'`)
  }

  const cuitReceptorParseado = datos.cuitReceptor
    ? parseInt(datos.cuitReceptor.replace(/-/g, ''), 10)
    : 0
  const nroDocRec = Number.isNaN(cuitReceptorParseado) ? 0 : cuitReceptorParseado

  const codAutNumerico = parseInt(datos.cae, 10)
  if (Number.isNaN(codAutNumerico)) {
    throw new Error(
      `CAE de la factura no es numérico parseable: '${datos.cae}'. ` +
        `Investigar corrupción de datos en facturas_afip.`,
    )
  }

  // Spec AFIP: la fecha va en formato YYYY-MM-DD (sin hora).
  // Aceptamos input ISO completo y nos quedamos con la parte de fecha.
  const fechaISO = datos.fecha.split('T')[0]

  // Orden de claves: idéntico al ejemplo oficial AFIP. NO reordenar.
  const payload = {
    ver: 1,
    fecha: fechaISO,
    cuit: cuitEmisor,
    ptoVta: datos.puntoVenta,
    tipoCmp: datos.tipoCmp,
    nroCmp: datos.nroCmp,
    importe: Math.round(datos.importe * 100) / 100,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: datos.cuitReceptor ? 80 : 99,
    nroDocRec,
    tipoCodAut: 'E',
    codAut: codAutNumerico,
  }

  const base64 = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `${URL_VERIFICADOR_AFIP}${base64}`
}
