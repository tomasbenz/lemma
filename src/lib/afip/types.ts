/**
 * Contrato del adaptador ARCA/AFIP.
 * El mock (mock.ts) y el adaptador real (real.ts cuando exista en Fase 5)
 * deben implementar AdaptadorAfip de manera idéntica.
 *
 * IMPORTANTE: para Iconic Fashion (única empresa por ahora) las facturas son
 * siempre tipo A o B (RI emisor). C aparece reservado para futuro multi-empresa
 * con emisores Monotributo. NC/ND para tipos A y B se incorporan en Sprint 3.
 */

import type { ComprobanteAsociado as ComprobanteAsociadoWsfe } from './wsfe/types'

// Re-exportado bajo alias para no chocar con el `ComprobanteAsociado`
// legacy (más abajo). El nuevo shape (wsfe-cercano: cbteTipo numérico,
// cuit obligatorio) es el que viaja al adapter real para NC/ND a partir
// de Sprint 3 / T2.
export type { ComprobanteAsociadoWsfe }

// ============================================================
// TIPOS DE COMPROBANTE (AFIP CbteTipo)
// ============================================================

export type TipoFacturaAfip =
  | 'factura_a'        // CbteTipo 1:  emisor RI a otro RI/Monotributo
  | 'factura_b'        // CbteTipo 6:  emisor RI a CF/Exento/etc
  | 'factura_c'        // CbteTipo 11: emisor Monotributo
  | 'nota_credito_a'   // CbteTipo 3:  NC A (Sprint 3) — alineado con DB enum
  | 'nota_credito_b'   // CbteTipo 8:  NC B (Sprint 3) — alineado con DB enum
  | 'nota_debito_a'    // CbteTipo 2:  ND A (Sprint 3) — alineado con DB enum
  | 'nota_debito_b'    // CbteTipo 7:  ND B (Sprint 3) — alineado con DB enum
  | 'nc_a'             // CbteTipo 3:  legacy (mock) — DEPRECADO, usar 'nota_credito_a'
  | 'nc_b'             // CbteTipo 8:  legacy (mock) — DEPRECADO, usar 'nota_credito_b'
  | 'nc_c'             // CbteTipo 13: legacy (mock)
  | 'nd_a'             // CbteTipo 2:  legacy (mock) — DEPRECADO, usar 'nota_debito_a'
  | 'nd_b'             // CbteTipo 7:  legacy (mock) — DEPRECADO, usar 'nota_debito_b'
  | 'nd_c'             // CbteTipo 12: legacy (mock)

/**
 * Mapping interno de TipoFacturaAfip a CbteTipo numérico de AFIP.
 * Se usa en el adaptador real (Fase 3+) al armar payloads SOAP de WSFE.
 * El mock no lo necesita pero conviene mantenerlo aquí para evitar duplicación.
 */
export const CBTE_TIPO_AFIP: Record<TipoFacturaAfip, number> = {
  factura_a: 1,
  factura_b: 6,
  factura_c: 11,
  nota_credito_a: 3,
  nota_credito_b: 8,
  nota_debito_a: 2,
  nota_debito_b: 7,
  nc_a: 3,
  nc_b: 8,
  nc_c: 13,
  nd_a: 2,
  nd_b: 7,
  nd_c: 12,
}

// ============================================================
// TIPO DE DOCUMENTO DEL RECEPTOR (AFIP DocTipo)
// ============================================================

export type TipoDocumentoReceptor =
  | { tipo: 80; nro: string }  // CUIT (11 dígitos)
  | { tipo: 86; nro: string }  // CUIL (11 dígitos)
  | { tipo: 96; nro: string }  // DNI (7-8 dígitos)
  | { tipo: 99; nro: '0' }     // Consumidor Final anónimo

// ============================================================
// CONDICIÓN IVA DEL RECEPTOR (CondicionIVAReceptorId, RG 5616/2024)
// ============================================================

export type CondIvaReceptor =
  | 1   // IVA Responsable Inscripto
  | 4   // IVA Sujeto Exento
  | 5   // Consumidor Final
  | 6   // Responsable Monotributo
  | 7   // Sujeto No Categorizado
  | 8   // Proveedor del Exterior
  | 9   // Cliente del Exterior
  | 10  // IVA Liberado - Ley 19.640
  | 13  // Monotributista Social
  | 15  // IVA No Alcanzado
  | 16  // Monotributo Trabajador Independiente Promovido

// ============================================================
// ALÍCUOTA DE IVA
// ============================================================

/** IDs de alícuotas según AFIP (FEParamGetTiposIva) */
export type IdAlicuotaIva = 3 | 4 | 5 | 6 | 8 | 9
// 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%, 8 = 5%, 9 = 2.5%

export type AlicuotaIva = {
  id: IdAlicuotaIva
  baseImp: number  // base imponible (neto sobre el que se aplica)
  importe: number  // importe del IVA calculado
}

// ============================================================
// CONCEPTO
// ============================================================

export type ConceptoFactura = 1 | 2 | 3
// 1 = Productos, 2 = Servicios, 3 = Productos y Servicios

// ============================================================
// COMPROBANTE ASOCIADO (NC y ND apuntan a la factura original)
// ============================================================

export type ComprobanteAsociado = {
  tipo: TipoFacturaAfip
  puntoVenta: number
  numero: number
  cuit?: string
  fecha?: string  // YYYY-MM-DD
}

// ============================================================
// ITEM FACTURADO
// ============================================================

/**
 * Item con precio YA proporcionado al monto a facturar.
 *
 * REGLA INVIOLABLE: el precio acá es el que va impreso en la factura,
 * no el precio neto del producto en sí. La proporción
 * (× 0.30, × 1.105, × 1.0, etc.) se aplica ANTES de armar este objeto,
 * dentro del server action emitir-factura-afip.ts.
 *
 * Invariante esperada (con tolerancia para el último item por redondeo):
 *   abs(cantidad × precioUnitarioFacturado - subtotalFacturado) < 0.05
 */
export type ItemFacturado = {
  productoNombre: string
  productoSku: string
  varianteSku: string
  cantidad: number
  precioUnitarioFacturado: number
  subtotalFacturado: number
}

// ============================================================
// RECEPTOR
// ============================================================

export type ReceptorFactura = {
  documento: TipoDocumentoReceptor
  razonSocial: string
  condIva: CondIvaReceptor
  domicilio?: string
}

// ============================================================
// INPUT PARA EMITIR
// ============================================================

export type DatosFacturaInput = {
  /**
   * UUID de la empresa emisora (Fase 4.b.1.B).
   *
   * Necesario para que el adapter real pueda obtener token, CUIT
   * representada y persistir auditoría con scope multi-tenant. El mock
   * lo ignora silenciosamente. NO opcional: el server action ya tiene
   * `user.empresa_id`, queremos forzar pasarlo para no caer en bug
   * silencioso de tenant cruzado.
   */
  empresaId: string

  /**
   * Callback opcional invocado con el id de la fila de afip_request_log
   * generada por la emisión (Fase 4.b.1.B). El adapter real lo propaga
   * al backend WSFE; el mock lo ignora. El server action lo usa para
   * persistir el ID en `ventas.ultimo_request_log_id`.
   */
  onRequestLogged?: (logId: number | null) => void

  ventaId: string
  tipoFactura: TipoFacturaAfip
  puntoVenta: number
  concepto: ConceptoFactura
  fechaEmision: string  // YYYY-MM-DD, ±10 días desde hoy para productos

  // Solo si concepto = 2 (servicios) o 3 (productos+servicios)
  fechaServicioDesde?: string
  fechaServicioHasta?: string
  fechaVtoPago?: string

  /**
   * Receptor de la factura.
   * - factura_a: receptor obligatorio con cond IVA 1 (RI) o 6 (Mono).
   * - factura_b/c: si receptor es null o documento.tipo=99, AFIP lo trata como
   *   Consumidor Final anónimo (con límite de monto regulado por AFIP).
   */
  receptor: ReceptorFactura | null

  /**
   * Items con precios YA proporcionados al monto a facturar.
   * Invariante: sum(items.subtotalFacturado) === montoTotal con tolerancia 0.05.
   */
  items: ItemFacturado[]

  /**
   * Alícuotas de IVA discriminadas.
   * - factura_a / factura_b: array NO vacío. Para Iconic siempre [{ id: 5, ... }].
   * - factura_c: array vacío [].
   * - Invariante para A/B: sum(baseImp) + sum(importe) === montoTotal con tolerancia 0.05.
   */
  alicuotas: AlicuotaIva[]

  /** Suma de baseImp de todas las alícuotas (= monto neto gravado total) */
  montoNetoGravado: number

  /** Suma de importe de todas las alícuotas. 0 para factura C. */
  montoIva: number

  /** Total final que aparece en la factura. = monto_facturado de la venta */
  montoTotal: number

  /** Solo para NC y ND: comprobantes a los que se asocia */
  comprobantesAsociados?: ComprobanteAsociado[]

  /**
   * Comprobante asociado (singular) — shape wsfe-cercano para el flujo
   * NC/ND nuevo (Sprint 3). El adapter real lo propaga al builder de
   * FECAESolicitar como bloque `<ar:CbtesAsoc>`. Convive con el legacy
   * `comprobantesAsociados` (que usa el mock); el adapter real solo
   * lee este campo.
   */
  comprobanteAsociado?: ComprobanteAsociadoWsfe
}

// ============================================================
// RESULTADO DE EMISIÓN
// ============================================================

export type ObservacionAfip = {
  codigo: number
  mensaje: string
}

export type EventoAfip = {
  codigo: number
  mensaje: string
}

export type ResultadoFacturaExito = {
  ok: true
  cae: string
  caeVencimiento: string  // YYYY-MM-DD
  numeroComprobante: number
  resultado: 'A' | 'P' | 'R'  // Aprobado / Parcial / Rechazado
  observaciones?: ObservacionAfip[]  // warnings que no rechazan, loguear para compliance
  eventos?: EventoAfip[]
  rawResponse: Record<string, unknown>
}

export type ResultadoFacturaError = {
  ok: false
  error: string
  codigoError?: number
  observaciones?: ObservacionAfip[]
  rawResponse?: Record<string, unknown>
}

export type ResultadoFactura = ResultadoFacturaExito | ResultadoFacturaError

// ============================================================
// RESULTADOS DE CONSULTA
// ============================================================

export type ResultadoConsultaUltimo =
  | { ok: true; numero: number }
  | { ok: false; error: string }

export type ResultadoConsulta =
  | {
      ok: true
      cae: string
      caeVencimiento: string
      numeroComprobante: number
      fechaEmision: string
      montoTotal: number
      rawResponse: Record<string, unknown>
    }
  | { ok: false; error: string }

export type ResultadoHealthcheck =
  | { ok: true; mensaje?: string }
  | { ok: false; mensaje: string }

// ============================================================
// CONTRATO DEL ADAPTADOR
// ============================================================

export interface AdaptadorAfip {
  /** Identificador para logs ('mock' | 'real') */
  readonly nombre: string

  /** Emite un comprobante en AFIP (o lo simula) y devuelve el CAE */
  emitir(datos: DatosFacturaInput): Promise<ResultadoFactura>

  /**
   * Consulta el último número emitido para un punto de venta + tipo.
   * Necesario antes de emitir para calcular el próximo número correlativo.
   */
  consultarUltimoComprobante(
    puntoVenta: number,
    tipoFactura: TipoFacturaAfip
  ): Promise<ResultadoConsultaUltimo>

  /**
   * Consulta un comprobante ya emitido.
   * Útil para reconciliar después de timeout: si se emitió pero el server
   * crasheó antes de guardar el CAE, consultar AFIP por punto venta + tipo
   * + número permite recuperar el CAE.
   */
  consultarComprobante(
    puntoVenta: number,
    tipoFactura: TipoFacturaAfip,
    numero: number
  ): Promise<ResultadoConsulta>

  /** Ping al servidor AFIP (para detectar caídas antes de procesar) */
  healthcheck(): Promise<ResultadoHealthcheck>
}
