import 'server-only'
import { getTokenSign } from '@/lib/afip/wsaa'
import { obtenerCuitEmpresa } from '@/lib/afip/empresa'
import { conReintentos, esErrorReintentableAfip } from '@/lib/afip/retry'
import {
  buildFEDummy,
  buildFECompUltimoAutorizado,
  buildFECAESolicitar,
  buildFECompConsultar,
} from './builders'
import {
  parseFEDummyResponse,
  parseFECompUltimoAutorizadoResponse,
  parseFECAESolicitarResponse,
  parseFECompConsultarResponse,
} from './parsers'
import { llamarWsfe } from './soap-client'
import { AfipWsfeError } from './types'
import type {
  ComprobanteAsociado,
  ResultadoHealthcheckWsfe,
  ResultadoConsultarUltimo,
  ParametrosConsultarUltimo,
  DatosReceptorFactura,
  ItemFacturaInput,
  ResultadoEmisionFactura,
  ParametrosConsultarComprobante,
  ResultadoConsultaComprobante,
} from './types'

/**
 * API pública del módulo WSFE.
 *
 * Este es el ÚNICO archivo del módulo wsfe que el resto del código debería
 * importar. Los archivos internos (builders, parsers, soap-client) son
 * detalles de implementación.
 *
 * Métodos disponibles (Fase 4.a + 4.b.0 + 4.b.1.A + Sprint 1):
 * - healthcheck(): chequea estado del servicio (sin auth)
 * - consultarUltimoComprobante(): obtiene el último número emitido
 * - consultarComprobante(): FECompConsultar — idempotencia pre-emisión
 * - emitirFactura(): FECAESolicitar — emite Factura A o B con CAE real
 *
 * Política de retry (decisión de producto):
 * - Solo se reintenta la llamada HTTP a AFIP (`llamarWsfe`).
 * - NO se reintenta `getTokenSign` ni `obtenerCuitEmpresa`: son ops
 *   distintas (cache + DB local) con su propio manejo de error.
 * - FECAESolicitar/FECompUltimoAutorizado/FEDummy: 3 intentos.
 * - FECompConsultar: 2 intentos (corto, ver `consultarComprobante`).
 * - Backoff exponencial 1s → 2s → 4s con jitter ±20%, ver retry.ts.
 */

export type {
  ComprobanteAsociado,
  ResultadoHealthcheckWsfe,
  ResultadoConsultarUltimo,
  ParametrosConsultarUltimo,
  TipoComprobanteAfip,
  DatosReceptorFactura,
  ItemFacturaInput,
  ResultadoEmisionFactura,
  ParametrosConsultarComprobante,
  ResultadoConsultaComprobante,
  ObservacionAfip,
} from './types'
export { AfipWsfeError } from './types'

const RETRY_AFIP = {
  maxIntentos: 3,
  baseMs: 1000,
  esReintentable: esErrorReintentableAfip,
} as const

function logRetry(metodo: string) {
  return (intento: number, err: unknown, delayMs: number) => {
    const motivo = err instanceof Error ? err.message : String(err)
    console.warn(
      '[AFIP/retry] intento',
      intento,
      'fallido, reintentando en',
      delayMs,
      'ms',
      { metodo, motivo },
    )
  }
}

export type ParametrosHealthcheck = {
  /**
   * Empresa por la cual se ejecuta el healthcheck. Aunque FEDummy no
   * requiere auth, igual lo logueamos en afip_request_log con el
   * empresa_id porque cada empresa tiene su propia config (modo, cuit,
   * cert) y queremos auditar por empresa.
   */
  empresaId: string
}

/**
 * Healthcheck del servicio WSFE.
 *
 * NO requiere autenticación, así que sirve también para validar que el
 * agente HTTP, los endpoints y el parsing básico funcionan sin involucrar
 * todavía el flujo completo de WSAA.
 */
export async function healthcheck(
  params: ParametrosHealthcheck,
): Promise<ResultadoHealthcheckWsfe> {
  const { empresaId } = params
  const envelope = buildFEDummy()
  const responseXml = await conReintentos(
    (intento) => llamarWsfe({ metodo: 'FEDummy', envelope, empresaId, intento }),
    {
      ...RETRY_AFIP,
      onIntentoFallido: logRetry('FEDummy'),
    },
  )
  return parseFEDummyResponse(responseXml)
}

/**
 * Consulta el último número de comprobante autorizado para el punto de venta
 * y tipo de comprobante indicados.
 *
 * Si nunca se emitió un comprobante de ese tipo, devuelve numeroComprobante = 0.
 * El próximo a emitir sería entonces el 1.
 */
export async function consultarUltimoComprobante(
  params: ParametrosConsultarUltimo
): Promise<ResultadoConsultarUltimo> {
  const { empresaId, puntoVenta, tipoComprobante } = params

  // 1. Obtener Token+Sign desde WSAA (la primera llamada genera y cachea;
  //    las siguientes leen del cache). NO se wrappea con retry — ver doc
  //    en wsaa/index.ts sobre rate limit de LoginCms.
  const { token, sign } = await getTokenSign({ empresaId, service: 'wsfe' })

  // 2. Obtener CUIT representada (la de la empresa, NO la del computador).
  //    AFIP valida que esta CUIT esté en la lista de relaciones del
  //    computador autenticado por WSAA. Si mandamos la CUIT del computador
  //    devuelve "ValidacionDeToken: No apareció CUIT en lista de relaciones".
  const cuitEmpresa = await obtenerCuitEmpresa(empresaId)

  // 3. Construir envelope con auth
  const envelope = buildFECompUltimoAutorizado({
    token,
    sign,
    cuit: cuitEmpresa,
    puntoVenta,
    tipoComprobante,
  })

  // 4. Llamar (con retry/backoff sobre la red+AFIP, no sobre WSAA ni DB)
  const responseXml = await conReintentos(
    (intento) =>
      llamarWsfe({
        metodo: 'FECompUltimoAutorizado',
        envelope,
        empresaId,
        intento,
      }),
    {
      ...RETRY_AFIP,
      onIntentoFallido: logRetry('FECompUltimoAutorizado'),
    },
  )

  // 5. Parsear
  return parseFECompUltimoAutorizadoResponse(responseXml)
}

/**
 * Consulta si un comprobante (puntoVenta, cbteTipo, cbteNro) ya fue emitido
 * en AFIP. Para idempotencia (Sprint 1).
 *
 * NO confundir con `adaptadorReal.consultarComprobante` (stub legacy en
 * `src/lib/afip/real.ts`). Esta es la implementación real, vive en wsfe.
 *
 * Comportamiento del retorno:
 * - `existe: false` → AFIP no tiene registro del comprobante.
 * - `existe: true, resultado: 'A'` → comprobante aprobado, devuelve datos.
 * - `existe: true, resultado: 'R'` → throw permanente (rechazado).
 * - `existe: true, resultado: 'P'` → throw requiere_admin (parcial).
 *
 * Retry corto: 2 intentos (vs 3 de FECAESolicitar). Razón: si la consulta
 * falla, no queremos sumar 12s de backoff antes del FECAESolicitar (que
 * también tiene su propio retry). Si falla 2 veces, propagamos error en
 * lugar de asumir "no existe" — asumir sería peligroso: podríamos emitir
 * sobre un cbteNro ya quemado.
 */
export async function consultarComprobante(
  params: ParametrosConsultarComprobante,
): Promise<ResultadoConsultaComprobante> {
  const { empresaId, puntoVenta, cbteTipo, cbteNro } = params

  const { token, sign } = await getTokenSign({ empresaId, service: 'wsfe' })
  const cuitEmpresa = await obtenerCuitEmpresa(empresaId)

  const envelope = buildFECompConsultar({
    token,
    sign,
    cuit: cuitEmpresa,
    puntoVenta,
    cbteTipo,
    cbteNro,
  })

  // Retry corto: 2 intentos en lugar de 3. Sin onLogged: la consulta se
  // registra igual en afip_request_log, pero no necesitamos persistir su
  // id en ventas.ultimo_request_log_id (eso es para FECAESolicitar).
  const responseXml = await conReintentos(
    (intento) =>
      llamarWsfe({
        metodo: 'FECompConsultar',
        envelope,
        empresaId,
        intento,
      }),
    {
      ...RETRY_AFIP,
      maxIntentos: 2,
      onIntentoFallido: logRetry('FECompConsultar'),
    },
  )

  const resultado = parseFECompConsultarResponse(responseXml)

  // Si existe pero no está aprobado, escalar antes que el caller lo use.
  if (resultado.existe && resultado.resultado === 'R') {
    throw new AfipWsfeError(
      `Comprobante ${puntoVenta}-${cbteNro} existe en AFIP pero está RECHAZADO (resultado=R)`,
      { metodo: 'FECompConsultar' },
      [{
        codigo: -2001,
        mensaje: 'comprobante existe pero rechazado',
        grupo: 'validacion',
        severidad: 'permanente',
        esConocido: true,
      }],
    )
  }
  if (resultado.existe && resultado.resultado === 'P') {
    throw new AfipWsfeError(
      `Comprobante ${puntoVenta}-${cbteNro} existe en AFIP en estado PARCIAL — investigar`,
      { metodo: 'FECompConsultar' },
      [{
        codigo: -2002,
        mensaje: 'comprobante en estado parcial',
        grupo: 'validacion',
        severidad: 'requiere_admin',
        esConocido: true,
      }],
    )
  }

  return resultado
}

export type ParametrosEmitirFactura = {
  empresaId: string
  puntoVenta: number
  /**
   * AFIP CbteTipo. Valores soportados:
   * - 1 = Factura A           - 6 = Factura B
   * - 2 = Nota Débito A       - 7 = Nota Débito B
   * - 3 = Nota Crédito A      - 8 = Nota Crédito B
   *
   * Para 2/3/7/8 (NC/ND) `comprobanteAsociado` es obligatorio.
   * Para 1/6 debe ser undefined.
   */
  cbteTipo: 1 | 2 | 3 | 6 | 7 | 8
  /** Default: hoy en hora Argentina. */
  fechaComprobante?: Date
  /** Total con IVA, ya prorrateado item por item por el caller. */
  montoFacturado: number
  receptor: DatosReceptorFactura
  items: ItemFacturaInput[]
  /**
   * Comprobante original que esta NC/ND está corrigiendo. Obligatorio
   * cuando cbteTipo es NC/ND (2/3/7/8); prohibido cuando es Factura A/B
   * (1/6). El builder valida la combinación con códigos locales -1003
   * (NC/ND sin asociado) y -1004 (Factura con asociado).
   */
  comprobanteAsociado?: ComprobanteAsociado
  /**
   * Callback opcional invocado con el id de afip_request_log generado por
   * la llamada FECAESolicitar. Útil para que el caller (server action via
   * adaptadorReal) lo persista en `ventas.ultimo_request_log_id` para
   * trazabilidad sin queries extra. Ver ParametrosLlamarWsfe.onLogged.
   */
  onRequestLogged?: (logId: number | null) => void
}

/**
 * Emite una factura electrónica vía FECAESolicitar y devuelve CAE.
 *
 * Flujo:
 * 1. Token+Sign desde WSAA (cache-friendly, no retry).
 * 2. CUIT representada de la empresa desde Supabase.
 * 3. Consulta `consultarUltimoComprobante` para conseguir el correlativo
 *    siguiente.
 * 4. **Idempotencia (Sprint 1)**: consulta `consultarComprobante` para ese
 *    cbteNro. Si AFIP ya lo emitió (escenario "red caída entre AFIP y
 *    nosotros"), validamos mismatch de monto y devolvemos el comprobante
 *    existente. Caller no se entera. Si el monto difiere → throw
 *    requiere_admin (mismo número, distinto importe = inconsistencia
 *    seria, pide intervención humana).
 * 5. Build del envelope con validaciones pre-AFIP (ver buildFECAESolicitar).
 * 6. Llamada con retry/backoff (3 intentos, 1s/2s/4s ±20% jitter).
 * 7. Parse del response — devuelve CAE/CAEFchVto/CbteNro o throw
 *    AfipWsfeError con severidad clasificada.
 *
 * @throws AfipWsfeError con severidad clasificada (ver parseFECAESolicitarResponse)
 */
export async function emitirFactura(
  params: ParametrosEmitirFactura,
): Promise<ResultadoEmisionFactura> {
  const {
    empresaId,
    puntoVenta,
    cbteTipo,
    fechaComprobante,
    montoFacturado,
    receptor,
    items,
    comprobanteAsociado,
    onRequestLogged,
  } = params

  // 1. Token+Sign
  const { token, sign } = await getTokenSign({ empresaId, service: 'wsfe' })

  // 2. CUIT representada
  const cuitEmpresa = await obtenerCuitEmpresa(empresaId)

  // 3. Próximo número correlativo
  const ultimo = await consultarUltimoComprobante({
    empresaId,
    puntoVenta,
    tipoComprobante: cbteTipo,
  })
  const cbteNro = ultimo.numeroComprobante + 1

  // 4. Idempotencia (Sprint 1): consultar si ese cbteNro ya existe en AFIP.
  //    Caso típico que cubrimos: red se cayó después de FECAESolicitar
  //    exitoso anterior, este intento pediría el mismo cbteNro y AFIP
  //    rechazaría con 10016 dejando trabajo manual de admin.
  //
  //    Si match exacto (mismo monto ±$0.01) → devolvemos el existente.
  //    Si mismatch de monto → throw requiere_admin: mismo número con
  //    distinto importe es una inconsistencia seria que pide intervención
  //    humana antes de seguir emitiendo en este PV.
  const existente = await consultarComprobante({
    empresaId,
    puntoVenta,
    cbteTipo,
    cbteNro,
  })

  if (existente.existe) {
    const TOLERANCIA_MONTO = 0.01
    const diferenciaMonto = Math.abs(existente.impTotal - montoFacturado)

    if (diferenciaMonto > TOLERANCIA_MONTO) {
      throw new AfipWsfeError(
        `Comprobante ${puntoVenta}-${cbteNro} existe en AFIP con monto distinto: ` +
          `esperado $${montoFacturado.toFixed(2)}, AFIP $${existente.impTotal.toFixed(2)} ` +
          `(diferencia $${diferenciaMonto.toFixed(2)}). Investigar manualmente.`,
        { metodo: 'FECompConsultar' },
        [{
          codigo: -2003,
          mensaje: 'mismatch monto comprobante existente',
          grupo: 'validacion',
          severidad: 'requiere_admin',
          esConocido: true,
        }],
      )
    }

    console.log(
      `[AFIP/WSFE] Idempotencia: comprobante ${puntoVenta}-${cbteNro} ya existía en AFIP, ` +
        `devuelvo existente (CAE ${existente.cae})`,
    )
    return {
      cae: existente.cae,
      caeFchVto: existente.caeFchVto,
      cbteNro: existente.cbteNro,
      resultado: 'A',
      observaciones: existente.observaciones,
    }
  }

  console.log(
    `[AFIP/WSFE] Emitiendo ${nombreTipoComprobante(cbteTipo)} N°${cbteNro} en PV ${puntoVenta}`,
  )

  // 5. Build envelope (validaciones pre-AFIP adentro)
  const envelope = buildFECAESolicitar({
    token,
    sign,
    cuit: cuitEmpresa,
    puntoVenta,
    cbteTipo,
    cbteNro,
    fechaComprobante,
    montoFacturado,
    receptor,
    items,
    comprobanteAsociado,
  })

  // 6. Llamada con retry. `onLogged` solo se setea para el ÚLTIMO log
  //    útil — si hay reintentos, va a ser invocado por cada intento; el
  //    último valor capturado es el que el caller persiste.
  const responseXml = await conReintentos(
    (intento) =>
      llamarWsfe({
        metodo: 'FECAESolicitar',
        envelope,
        empresaId,
        intento,
        onLogged: onRequestLogged,
      }),
    {
      ...RETRY_AFIP,
      onIntentoFallido: logRetry('FECAESolicitar'),
    },
  )

  // 7. Parse y devolver CAE
  return parseFECAESolicitarResponse(responseXml)
}

/**
 * Devuelve un nombre legible para el cbteTipo. Solo se usa para logging.
 */
function nombreTipoComprobante(cbteTipo: 1 | 2 | 3 | 6 | 7 | 8): string {
  switch (cbteTipo) {
    case 1: return 'Factura A'
    case 2: return 'Nota Débito A'
    case 3: return 'Nota Crédito A'
    case 6: return 'Factura B'
    case 7: return 'Nota Débito B'
    case 8: return 'Nota Crédito B'
  }
}
