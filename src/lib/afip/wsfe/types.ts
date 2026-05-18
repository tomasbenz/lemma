import type { ErrorAfipTraducido, SeveridadErrorAfip } from '@/lib/afip/errors'

/**
 * Tipos públicos del módulo WSFE.
 *
 * No usa server-only porque son solo type definitions sin runtime
 * propio del servidor. La clase AfipWsfeError sí es runtime, pero
 * puede instanciarse igual desde cualquier contexto que reciba un
 * error propagado.
 */

/**
 * Tipo de comprobante según codificación AFIP.
 * Lista parcial, ampliar según necesidad.
 *
 * 1  = Factura A
 * 6  = Factura B
 * 11 = Factura C
 * 51 = Factura M (a definir, no usado hoy)
 * 81 = Tique Factura A
 * 82 = Tique Factura B
 * 3  = Nota de Crédito A
 * 8  = Nota de Crédito B
 * 13 = Nota de Crédito C
 * 2  = Nota de Débito A
 * 7  = Nota de Débito B
 * 12 = Nota de Débito C
 */
export type TipoComprobanteAfip = 1 | 2 | 3 | 6 | 7 | 8 | 11 | 12 | 13 | 51 | 81 | 82

/**
 * Resultado del healthcheck del servicio WSFE.
 * Cada flag puede ser 'OK' o 'ERROR'.
 */
export type ResultadoHealthcheckWsfe = {
  appServer: 'OK' | 'ERROR'
  dbServer: 'OK' | 'ERROR'
  authServer: 'OK' | 'ERROR'
}

/**
 * Parámetros para consultar último comprobante autorizado.
 */
export type ParametrosConsultarUltimo = {
  empresaId: string
  puntoVenta: number
  tipoComprobante: TipoComprobanteAfip
}

/**
 * Resultado de consultar último comprobante autorizado.
 *
 * Si numeroComprobante es 0, significa que NUNCA se emitió un comprobante
 * de ese tipo en ese punto de venta (el próximo a emitir es el 1).
 */
export type ResultadoConsultarUltimo = {
  puntoVenta: number
  tipoComprobante: TipoComprobanteAfip
  numeroComprobante: number
}

// ============================================================
// FECAESolicitar (Fase 4.b.1.A) — emisión real con CAE
// ============================================================

/**
 * Datos del receptor de la factura.
 *
 * - docTipo 80 (CUIT): obligatorio para Factura A.
 * - docTipo 96 (DNI): aceptable para Factura B con cliente identificado.
 * - docTipo 99 (Consumidor Final anónimo): solo Factura B, docNro='0'.
 *
 * condicionIVAReceptorId (RG 5616, obligatorio desde 2024):
 * - 1  = Responsable Inscripto
 * - 4  = IVA Sujeto Exento
 * - 5  = Consumidor Final
 * - 6  = Monotributista
 * - 13 = Monotributo Social
 * (lista parcial; ampliar según necesidad)
 */
export type DatosReceptorFactura = {
  /** 80 (CUIT), 96 (DNI), o 99 (CF anónimo). */
  docTipo: 80 | 96 | 99
  /** Número del documento. Para CF anónimo: '0'. */
  docNro: string
  /** AFIP CondicionIVAReceptorId. RI=1, MONO=6, CF=5, etc. */
  condicionIVAReceptorId: number
}

/**
 * Item de la factura ya pre-procesado por el caller (Fase 4.b.1.B aplica
 * la regla inviolable de proporción a `monto_facturado`).
 *
 * En Fase 4.b.1.A los items NO se incluyen en el envelope FECAESolicitar
 * (AFIP no los exige campo por campo — solo totales). Pasan acá para
 * que el builder pueda hacer un sanity-check: la suma de `subtotalConIva`
 * tiene que coincidir con `montoFacturado` ±0.01.
 */
export type ItemFacturaInput = {
  cantidad: number
  /** Precio unitario CON IVA (consistente con regla inviolable de Tomás). */
  precioUnitarioConIva: number
  /** Subtotal con IVA = cantidad × precioUnitarioConIva, ya prorrateado. */
  subtotalConIva: number
}

/**
 * Resultado de FECAESolicitar.
 *
 * - resultado='A' → CAE válido, factura emitida.
 * - resultado='R' → AFIP rechaza, parser tira AfipWsfeError antes (no
 *   llega a este shape).
 * - resultado='P' → parcial (solo posible con CantReg>1, no aplica acá).
 *
 * `observaciones` son warnings que NO impiden la emisión. Pueden venir
 * incluso con resultado='A'. Persistir para auditoría.
 */
export type ResultadoEmisionFactura = {
  cae: string
  caeFchVto: string  // yyyymmdd
  cbteNro: number
  resultado: 'A' | 'R' | 'P'
  observaciones: ObservacionAfip[]
}

/**
 * Observación AFIP — warning que NO impide emisión, o error en
 * Resultado='R'. Mismo shape para FECAESolicitar y FECompConsultar.
 */
export type ObservacionAfip = {
  codigo: number
  mensaje: string
}

/**
 * Comprobante asociado a una NC/ND. Identifica la factura original
 * que la nota está corrigiendo. AFIP requiere este vínculo para
 * todos los cbteTipo de NC y ND (2, 3, 7, 8).
 *
 * Notar shape distinto al `ComprobanteAsociado` legacy en
 * `src/lib/afip/types.ts`: este es el contrato AFIP-cercano —
 * cbteTipo numérico, cuit obligatorio (parseado a número en el
 * envelope). El legacy usa el enum interno `TipoFacturaAfip`
 * (string) y cuit opcional; sigue vivo para compatibilidad con el
 * mock pero no se usa en el flujo NC/ND nuevo.
 */
export type ComprobanteAsociado = {
  /** cbteTipo de la factura original (1 = A, 6 = B). */
  tipo: 1 | 6
  puntoVenta: number
  numero: number
  /** CUIT del emisor de la factura original (siempre el mismo emisor). */
  cuit: string
}

// ============================================================
// FECompConsultar (Sprint 1) — idempotencia
// ============================================================

/**
 * Parámetros para consultar si un comprobante ya fue emitido.
 */
export type ParametrosConsultarComprobante = {
  empresaId: string
  puntoVenta: number
  cbteTipo: number
  cbteNro: number
}

/**
 * Resultado de FECompConsultar (Sprint 1 — idempotencia).
 *
 * Devuelve los datos del comprobante existente, o flag de "no existe".
 *
 * Cuando `existe: true`, el shape es compatible con `ResultadoEmisionFactura`
 * para que `emitirFactura` pueda devolver el comprobante existente como si
 * acabara de emitirlo (caller no se entera de la idempotencia).
 */
export type ResultadoConsultaComprobante =
  | { existe: false }
  | {
      existe: true
      cae: string
      caeFchVto: string  // yyyymmdd
      cbteNro: number
      resultado: 'A' | 'R' | 'P'
      /** Monto total del comprobante existente, para validar mismatch. */
      impTotal: number
      observaciones: ObservacionAfip[]
    }

/**
 * Orden de gravedad de severidades AFIP, de mayor a menor:
 *   requiere_admin > permanente > reintentable.
 *
 * Usado por AfipWsfeError.severidadMaxima.
 */
const ORDEN_SEVERIDAD: Record<SeveridadErrorAfip, number> = {
  requiere_admin: 3,
  permanente: 2,
  reintentable: 1,
}

/**
 * Error específico del módulo WSFE.
 *
 * Contiene los códigos crudos de AFIP, los mensajes traducidos al
 * diccionario interno (errors.ts), y un getter `severidadMaxima` que
 * resuelve la severidad más grave entre todos los errores reportados.
 *
 * Si no hay erroresTraducidos (ej. SOAP Fault sin códigos, o respuesta
 * incompleta de parsing), severidadMaxima default = 'permanente' por
 * conservadurismo: no retry-eamos errores no clasificados.
 */
export class AfipWsfeError extends Error {
  public readonly erroresTraducidos: readonly ErrorAfipTraducido[]

  constructor(
    message: string,
    public readonly contexto: {
      metodo: string
      codigosError?: number[]
      mensajesError?: string[]
      raw?: string
    },
    erroresTraducidos: readonly ErrorAfipTraducido[] = [],
  ) {
    super(message)
    this.name = 'AfipWsfeError'
    this.erroresTraducidos = erroresTraducidos
  }

  /**
   * Severidad más grave entre los errores traducidos.
   * Default 'permanente' si no hay traducidos (ver doc de la clase).
   */
  get severidadMaxima(): SeveridadErrorAfip {
    if (this.erroresTraducidos.length === 0) return 'permanente'

    let max: SeveridadErrorAfip = 'reintentable'
    let maxOrden = 0
    for (const err of this.erroresTraducidos) {
      const orden = ORDEN_SEVERIDAD[err.severidad]
      if (orden > maxOrden) {
        max = err.severidad
        maxOrden = orden
      }
    }
    return max
  }
}
