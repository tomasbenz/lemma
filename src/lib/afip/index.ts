import 'server-only'
import { adaptadorMock } from './mock'
import { adaptadorReal } from './real'
import type { AdaptadorAfip } from './types'

/**
 * Selector de adaptador AFIP.
 *
 * Usa el real si:
 * - AFIP_MODE === 'homologation' o 'production'
 * - Las env vars de cert están presentes (AFIP_CERT_B64, AFIP_KEY_B64)
 * - AFIP_CUIT (computador) presente
 *
 * En cualquier otro caso usa el mock (dev local sin AFIP, tests, etc.).
 *
 * IMPORTANTE: cuando AFIP_MODE='production' es real con AFIP REAL.
 * Solo cambiarse a producción con cert productivo (no homo) y después
 * de validar end-to-end en homologación.
 *
 * Decisión de log: cero ruido. El selector es invisible al consumidor —
 * `afip.emitir()` se comporta igual con cualquier adapter. Si necesitás
 * debug, levantar manualmente `process.env.AFIP_MODE` o consultar
 * `afip.nombre` ('mock' | 'real').
 */
function seleccionarAdaptador(): AdaptadorAfip {
  const modo = process.env.AFIP_MODE
  const tieneCertCompleto =
    !!process.env.AFIP_CERT_B64 &&
    !!process.env.AFIP_KEY_B64 &&
    !!process.env.AFIP_CUIT

  if ((modo === 'homologation' || modo === 'production') && tieneCertCompleto) {
    return adaptadorReal
  }
  return adaptadorMock
}

export const afip: AdaptadorAfip = seleccionarAdaptador()

export type {
  AdaptadorAfip,
  AlicuotaIva,
  ComprobanteAsociado,
  ComprobanteAsociadoWsfe,
  ConceptoFactura,
  CondIvaReceptor,
  DatosFacturaInput,
  EventoAfip,
  IdAlicuotaIva,
  ItemFacturado,
  ObservacionAfip,
  ReceptorFactura,
  ResultadoConsulta,
  ResultadoConsultaUltimo,
  ResultadoFactura,
  ResultadoFacturaError,
  ResultadoFacturaExito,
  ResultadoHealthcheck,
  TipoDocumentoReceptor,
  TipoFacturaAfip,
} from './types'
