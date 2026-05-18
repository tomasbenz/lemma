import 'server-only'
import type {
  ComprobanteAsociado,
  DatosReceptorFactura,
  ItemFacturaInput,
  TipoComprobanteAfip,
} from './types'
import { AfipWsfeError } from './types'
import type { ErrorAfipTraducido } from '@/lib/afip/errors'
import { formatearFechaYYYYMMDD } from '@/lib/afip/fechas'

/**
 * Builders de XML SOAP para los métodos de WSFE.
 *
 * Construimos el XML a mano (sin librería SOAP genérica) porque el envelope
 * es simple y predecible. Una librería sería overkill y agregaría dependencia.
 *
 * Reglas críticas:
 * - El namespace SOAP es 'http://schemas.xmlsoap.org/soap/envelope/'
 * - El namespace de WSFE es 'http://ar.gov.afip.dif.FEV1/' (prefijo 'ar')
 * - Cuit en el Auth se manda como NÚMERO sin comillas, no como string.
 *   AFIP rechaza si va como string.
 */

/**
 * Genera el envelope SOAP para FEDummy (healthcheck, sin auth).
 */
export function buildFEDummy(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Header/>
  <soap:Body>
    <ar:FEDummy/>
  </soap:Body>
</soap:Envelope>`
}

export type ParametrosBuildFECompUltimoAutorizado = {
  token: string
  sign: string
  cuit: string  // Lo recibimos como string (CUIT representada de la empresa, vía obtenerCuitEmpresa) y lo convertimos a número para AFIP
  puntoVenta: number
  tipoComprobante: TipoComprobanteAfip
}

/**
 * Genera el envelope SOAP para FECompUltimoAutorizado.
 *
 * IMPORTANTE: cuit se inserta como número en el XML, no como string.
 * Defensivo: validamos que el parseInt funcione aunque getAfipConfig() ya lo
 * valida con regex /^\d{11}$/. Doble check no hace daño.
 */
export function buildFECompUltimoAutorizado(
  params: ParametrosBuildFECompUltimoAutorizado,
): string {
  const { token, sign, cuit, puntoVenta, tipoComprobante } = params
  const cuitNumero = parseInt(cuit, 10)

  if (Number.isNaN(cuitNumero)) {
    throw new Error(`CUIT inválido: "${cuit}" no es numérico`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Header/>
  <soap:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${escaparXml(token)}</ar:Token>
        <ar:Sign>${escaparXml(sign)}</ar:Sign>
        <ar:Cuit>${cuitNumero}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soap:Body>
</soap:Envelope>`
}

// ============================================================
// FECAESolicitar (Fase 4.b.1.A) — emisión real con CAE
// ============================================================

export type ParametrosBuildFECAESolicitar = {
  token: string
  sign: string
  /** CUIT del emisor (representada). String de 11 dígitos. */
  cuit: string
  puntoVenta: number
  /**
   * AFIP CbteTipo. Valores soportados:
   * - 1 = Factura A
   * - 6 = Factura B
   * - 2 = Nota Débito A
   * - 3 = Nota Crédito A
   * - 7 = Nota Débito B
   * - 8 = Nota Crédito B
   */
  cbteTipo: 1 | 2 | 3 | 6 | 7 | 8
  /** Próximo número correlativo (lo calcula afuera con consultarUltimoComprobante + 1). */
  cbteNro: number
  /** Fecha del comprobante. Default new Date(). AFIP la quiere yyyymmdd en hora Argentina. */
  fechaComprobante?: Date
  /** Importe TOTAL facturado (con IVA), suma de subtotalConIva de los items con tolerancia 0.01. */
  montoFacturado: number
  receptor: DatosReceptorFactura
  /** Items prorrateados — solo para sanity check, NO se incluyen en el envelope. */
  items: ItemFacturaInput[]
  /**
   * Comprobante asociado. Obligatorio cuando cbteTipo es NC/ND (2/3/7/8),
   * prohibido cuando es Factura A/B (1/6). El builder valida la combinación
   * y throwea AfipWsfeError local antes de llamar a AFIP.
   */
  comprobanteAsociado?: ComprobanteAsociado
}

const ALICUOTA_IVA_ID = 5  // AFIP: Id=5 es 21%, único usado por Iconic Fashion (RI)
const TOLERANCIA_MONTO = 0.01

/**
 * Genera el envelope SOAP para FECAESolicitar.
 *
 * Decisiones cerradas (NO replantear):
 * - Concepto fijo = 1 (Productos). Sin servicios, sin mixta.
 * - Alícuota fija = 21% (regla inviolable #5 de Tomás).
 * - Moneda fija = PES (pesos argentinos), MonCotiz=1.
 * - CantReg fija = 1 (emitimos de a una para idempotencia y simpleza).
 * - ImpTotConc, ImpOpEx, ImpTrib fijos = 0 (Iconic no opera fuera del
 *   IVA gravado; cuando aplique algún rubro raro se extiende esto).
 *
 * Validaciones (throw AfipWsfeError ANTES de salir a red):
 * - cbteTipo no en [1, 2, 3, 6, 7, 8]
 * - cbteTipo NC/ND (2/3/7/8) sin comprobanteAsociado → -1003
 * - cbteTipo Factura A/B (1/6) con comprobanteAsociado → -1004
 * - Factura A / NC A / ND A sin CUIT del receptor → severidad requiere_admin
 * - Factura A / NC A / ND A a Consumidor Final → severidad requiere_admin
 * - puntoVenta/cbteNro no enteros positivos
 * - montoFacturado <= 0
 * - sum(items.subtotalConIva) ≠ montoFacturado (tolerancia 0.01)
 */
export function buildFECAESolicitar(p: ParametrosBuildFECAESolicitar): string {
  const {
    token,
    sign,
    cuit,
    puntoVenta,
    cbteTipo,
    cbteNro,
    fechaComprobante,
    montoFacturado,
    receptor,
    items,
    comprobanteAsociado,
  } = p

  // ---- Validaciones ----
  const tiposSoportados: ReadonlyArray<1 | 2 | 3 | 6 | 7 | 8> = [1, 2, 3, 6, 7, 8]
  if (!tiposSoportados.includes(cbteTipo)) {
    throw new AfipWsfeError(
      `Tipo de comprobante no soportado: ${cbteTipo}. Soportados: 1 (Fact A), 6 (Fact B), 2 (ND A), 3 (NC A), 7 (ND B), 8 (NC B).`,
      { metodo: 'FECAESolicitar' },
    )
  }

  // Las "tipo A" para validar receptor incluyen Factura A, NC A y ND A.
  // El receptor de una NC/ND tiene que ser idéntico al de la factura
  // original (RI con CUIT) — AFIP lo rechaza si no.
  const esTipoA = cbteTipo === 1 || cbteTipo === 2 || cbteTipo === 3
  const esNcOnD = cbteTipo === 2 || cbteTipo === 3 || cbteTipo === 7 || cbteTipo === 8

  if (esNcOnD && !comprobanteAsociado) {
    throw new AfipWsfeError(
      `NC/ND (cbteTipo ${cbteTipo}) requiere comprobanteAsociado — falta vínculo a la factura original`,
      { metodo: 'FECAESolicitar' },
      [erroresLocales.ncNdSinComprobanteAsociado],
    )
  }

  if (!esNcOnD && comprobanteAsociado) {
    throw new AfipWsfeError(
      `Factura común (cbteTipo ${cbteTipo}) no debe llevar comprobanteAsociado — solo aplica a NC/ND`,
      { metodo: 'FECAESolicitar' },
      [erroresLocales.facturaConComprobanteAsociado],
    )
  }

  if (esTipoA && receptor.docTipo !== 80) {
    throw new AfipWsfeError(
      'Factura A / NC A / ND A requieren CUIT del receptor — completar datos del cliente antes de emitir',
      { metodo: 'FECAESolicitar' },
      [erroresLocales.facturaASinCuit],
    )
  }

  if (esTipoA && receptor.condicionIVAReceptorId === 5) {
    throw new AfipWsfeError(
      'Factura A / NC A / ND A no se emiten a Consumidor Final — usar comprobante tipo B',
      { metodo: 'FECAESolicitar' },
      [erroresLocales.facturaAaConsumidorFinal],
    )
  }

  if (!Number.isInteger(puntoVenta) || puntoVenta < 1) {
    throw new AfipWsfeError(
      `puntoVenta debe ser entero positivo, recibido: ${puntoVenta}`,
      { metodo: 'FECAESolicitar' },
    )
  }

  if (!Number.isInteger(cbteNro) || cbteNro < 1) {
    throw new AfipWsfeError(
      `cbteNro debe ser entero positivo, recibido: ${cbteNro}`,
      { metodo: 'FECAESolicitar' },
    )
  }

  if (montoFacturado <= 0) {
    throw new AfipWsfeError(
      `montoFacturado debe ser positivo, recibido: ${montoFacturado}`,
      { metodo: 'FECAESolicitar' },
    )
  }

  const sumaItems = items.reduce((acc, it) => acc + it.subtotalConIva, 0)
  if (Math.abs(montoFacturado - sumaItems) > TOLERANCIA_MONTO) {
    throw new AfipWsfeError(
      `Items no suman al monto facturado: items=${round2(sumaItems)} vs monto=${round2(montoFacturado)} (tolerancia ${TOLERANCIA_MONTO})`,
      { metodo: 'FECAESolicitar' },
    )
  }

  const cuitNumero = parseInt(cuit, 10)
  if (Number.isNaN(cuitNumero)) {
    throw new AfipWsfeError(
      `CUIT inválido: "${cuit}" no es numérico`,
      { metodo: 'FECAESolicitar' },
    )
  }

  // CUIT del comprobante asociado: parseamos antes de armar XML para
  // detectar string mal formado y no inyectar NaN al envelope.
  let cuitAsociadoNumero: number | null = null
  if (comprobanteAsociado) {
    cuitAsociadoNumero = parseInt(comprobanteAsociado.cuit, 10)
    if (Number.isNaN(cuitAsociadoNumero)) {
      throw new AfipWsfeError(
        `CUIT de comprobante asociado inválido: "${comprobanteAsociado.cuit}" no es numérico`,
        { metodo: 'FECAESolicitar' },
      )
    }
  }

  // ---- Cálculos AFIP ----
  // Descomposición del monto: regla inviolable #5 → IVA 21% siempre.
  // Tanto Factura A como B llevan IVA discriminado en el envelope.
  const impNeto = round2(montoFacturado / 1.21)
  const impIVA = round2(montoFacturado - impNeto)
  const impTotal = round2(montoFacturado)
  // Por construcción: impTotal === impNeto + impIVA con tolerancia ≤ 0.01.

  const fecha = fechaComprobante ?? new Date()
  const cbteFch = formatearFechaYYYYMMDD(fecha)

  // Bloque CbtesAsoc — solo si hay comprobante asociado (NC/ND).
  // Va ANTES de <ar:Iva> según el WSDL/spec WSFEv1.5.8.4.
  const xmlCbtesAsoc =
    comprobanteAsociado && cuitAsociadoNumero !== null
      ? `            <ar:CbtesAsoc>
              <ar:CbteAsoc>
                <ar:Tipo>${comprobanteAsociado.tipo}</ar:Tipo>
                <ar:PtoVta>${comprobanteAsociado.puntoVenta}</ar:PtoVta>
                <ar:Nro>${comprobanteAsociado.numero}</ar:Nro>
                <ar:Cuit>${cuitAsociadoNumero}</ar:Cuit>
              </ar:CbteAsoc>
            </ar:CbtesAsoc>
`
      : ''

  // ---- XML ----
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Header/>
  <soap:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${escaparXml(token)}</ar:Token>
        <ar:Sign>${escaparXml(sign)}</ar:Sign>
        <ar:Cuit>${cuitNumero}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${receptor.docTipo}</ar:DocTipo>
            <ar:DocNro>${escaparXml(receptor.docNro)}</ar:DocNro>
            <ar:CbteDesde>${cbteNro}</ar:CbteDesde>
            <ar:CbteHasta>${cbteNro}</ar:CbteHasta>
            <ar:CbteFch>${cbteFch}</ar:CbteFch>
            <ar:ImpTotal>${impTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0</ar:ImpTotConc>
            <ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0</ar:ImpOpEx>
            <ar:ImpIVA>${impIVA.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>${receptor.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>
${xmlCbtesAsoc}            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>${ALICUOTA_IVA_ID}</ar:Id>
                <ar:BaseImp>${impNeto.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${impIVA.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`
}

/**
 * Errores locales de validación pre-AFIP, marcados como `requiere_admin`
 * para que el caller (recovery.ts en Fase 4.b.1.B) clasifique la venta
 * en `error_permanente` y NO la reintente. Códigos negativos para no
 * colisionar con códigos reales de AFIP (que son positivos >= 10000).
 *
 * Convención de códigos locales:
 * - -1001 / -1002: validaciones FECAESolicitar (Fase 4.b.1.A).
 * - -1003 / -1004: validaciones cruzadas NC/ND ↔ comprobanteAsociado (Sprint 3 / T2).
 * - -1101 / -1102: validaciones FECompConsultar (Sprint 1, idempotencia).
 */
const erroresLocales: Record<string, ErrorAfipTraducido> = {
  facturaASinCuit: {
    codigo: -1001,
    mensaje: 'Factura A requiere CUIT del receptor',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: true,
  },
  facturaAaConsumidorFinal: {
    codigo: -1002,
    mensaje: 'Factura A no se emite a Consumidor Final',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: true,
  },
  ncNdSinComprobanteAsociado: {
    codigo: -1003,
    mensaje: 'NC/ND requiere comprobanteAsociado a la factura original',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: true,
  },
  facturaConComprobanteAsociado: {
    codigo: -1004,
    mensaje: 'Factura común no debe llevar comprobanteAsociado',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: true,
  },
  consultaPuntoVentaInvalido: {
    codigo: -1101,
    mensaje: 'Punto de venta inválido para consulta',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: false,
  },
  consultaCbteNroInvalido: {
    codigo: -1102,
    mensaje: 'Número de comprobante inválido',
    grupo: 'validacion',
    severidad: 'requiere_admin',
    esConocido: false,
  },
}

// ============================================================
// FECompConsultar (Sprint 1) — idempotencia
// ============================================================

export type ParametrosBuildFECompConsultar = {
  token: string
  sign: string
  /** CUIT representada (string de 11 dígitos). Se convierte a número en el XML. */
  cuit: string
  puntoVenta: number
  cbteTipo: number
  cbteNro: number
}

/**
 * Genera el envelope SOAP para FECompConsultar.
 *
 * Spec AFIP: WSFEv1.5.8.4, sección FECompConsultar. Recibe (PtoVta, CbteTipo,
 * CbteNro) y devuelve los datos del comprobante si existe, o un Errors
 * collection si no.
 *
 * Validaciones locales (mismas reglas que FECAESolicitar para consistencia):
 * - puntoVenta entero positivo → -1101 si falla
 * - cbteNro entero positivo → -1102 si falla
 *
 * NO validamos cbteTipo: la consulta puede pedir cualquier tipo y AFIP
 * devuelve "no existe" si el tipo es inválido. No vale la pena duplicar la
 * lista de tipos soportados acá.
 */
export function buildFECompConsultar(p: ParametrosBuildFECompConsultar): string {
  const { token, sign, cuit, puntoVenta, cbteTipo, cbteNro } = p

  if (!Number.isInteger(puntoVenta) || puntoVenta < 1) {
    throw new AfipWsfeError(
      `Punto de venta inválido para consulta: ${puntoVenta}`,
      { metodo: 'FECompConsultar' },
      [erroresLocales.consultaPuntoVentaInvalido],
    )
  }
  if (!Number.isInteger(cbteNro) || cbteNro < 1) {
    throw new AfipWsfeError(
      `Número de comprobante inválido: ${cbteNro}`,
      { metodo: 'FECompConsultar' },
      [erroresLocales.consultaCbteNroInvalido],
    )
  }

  const cuitNumero = parseInt(cuit, 10)
  if (Number.isNaN(cuitNumero)) {
    throw new AfipWsfeError(
      `CUIT inválido: "${cuit}" no es numérico`,
      { metodo: 'FECompConsultar' },
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Header/>
  <soap:Body>
    <ar:FECompConsultar>
      <ar:Auth>
        <ar:Token>${escaparXml(token)}</ar:Token>
        <ar:Sign>${escaparXml(sign)}</ar:Sign>
        <ar:Cuit>${cuitNumero}</ar:Cuit>
      </ar:Auth>
      <ar:FeCompConsReq>
        <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
        <ar:CbteNro>${cbteNro}</ar:CbteNro>
        <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      </ar:FeCompConsReq>
    </ar:FECompConsultar>
  </soap:Body>
</soap:Envelope>`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Escapa caracteres XML peligrosos en valores de texto.
 * El Token y Sign de AFIP suelen tener `+`, `/`, `=` que son seguros,
 * pero por las dudas escapamos los chars XML estándar.
 */
function escaparXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
