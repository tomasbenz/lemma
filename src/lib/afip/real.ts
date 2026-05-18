import 'server-only'
import type {
  AdaptadorAfip,
  DatosFacturaInput,
  ItemFacturado,
  ReceptorFactura,
  ResultadoConsulta,
  ResultadoConsultaUltimo,
  ResultadoFactura,
  ResultadoHealthcheck,
} from './types'
import { emitirFactura } from './wsfe'
import type {
  DatosReceptorFactura,
  ItemFacturaInput,
  ResultadoEmisionFactura,
} from './wsfe/types'
import { AfipWsfeError } from './wsfe/types'
import { traducirErrorAfip } from './errors'

/**
 * Adapter AFIP real (Fase 4.b.1.B).
 *
 * Traduce el contrato legacy `AdaptadorAfip` a la API nueva del módulo
 * `wsfe` (`emitirFactura`). Sigue exponiendo el contrato legacy para no
 * romper los callers actuales (`server action emitir-factura-afip`).
 * Cuando Fase 4.b.2 consolide el módulo, el server action se va a
 * migrar a llamar `emitirFactura` directo y este wrapper se elimina.
 *
 * Métodos:
 * - `emitir`: implementación REAL. Traduce DatosFacturaInput →
 *   ParametrosEmitirFactura, captura AfipWsfeError, traduce a
 *   ResultadoFactura.
 * - `consultarUltimoComprobante`, `consultarComprobante`, `healthcheck`:
 *   STUBS. El contrato legacy de estos no recibe `empresaId` (multi-
 *   tenant), por lo que no se puede mapear 1-a-1 a la API nueva sin
 *   romper el contrato. Como el server action solo invoca `.emitir`,
 *   estos métodos quedan como stubs que devuelven errores claros. Si
 *   un caller futuro los necesita, el contrato `AdaptadorAfip` debe
 *   ampliarse con `empresaId`.
 */

// ============================================================
// Traducción de tipos
// ============================================================

/**
 * Traduce el `tipoFactura` legacy a `cbteTipo` AFIP numérico.
 *
 * Mapeo:
 * - 'factura_a'      → 1 (Factura A: RI a RI/MONO)
 * - 'factura_b'      → 6 (Factura B: RI a CF/Exento/etc)
 * - 'factura_c'      → 6 (defensivo: emisores RI no emiten C; mapeamos
 *                         a B para no romper si el caller manda C por
 *                         error de routing.)
 * - 'nota_debito_a'  → 2
 * - 'nota_credito_a' → 3
 * - 'nota_debito_b'  → 7
 * - 'nota_credito_b' → 8
 *
 * Los valores legacy `nc_a`/`nc_b`/`nc_c`/`nd_a`/`nd_b`/`nd_c` siguen
 * vivos en `TipoFacturaAfip` para que el mock compile, pero NO los
 * recibe el adapter real: el server action y la DB ya emiten los
 * valores largos `nota_credito_*`/`nota_debito_*`. Si llegara uno
 * legacy, throw — indica un bug en el caller.
 */
function traducirTipoFactura(t: DatosFacturaInput['tipoFactura']): 1 | 2 | 3 | 6 | 7 | 8 {
  if (t === 'factura_a') return 1
  if (t === 'factura_b' || t === 'factura_c') return 6
  if (t === 'nota_debito_a') return 2
  if (t === 'nota_credito_a') return 3
  if (t === 'nota_debito_b') return 7
  if (t === 'nota_credito_b') return 8
  // Tipos legacy nc_*/nd_* (solo soportados por el mock) o futuros no
  // mapeados. Si algún día se elimina el legacy, este throw se vuelve
  // inalcanzable y TS infiere `never` automáticamente.
  throw new Error(`tipoFactura "${t as string}" no soportado por adaptador real`)
}

/**
 * Traduce `ReceptorFactura | null` legacy → `DatosReceptorFactura` de wsfe.
 *
 * Si receptor es null (CF anónimo total), usamos:
 *   { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 }
 */
function traducirReceptor(r: ReceptorFactura | null): DatosReceptorFactura {
  if (r === null) {
    return { docTipo: 99, docNro: '0', condicionIVAReceptorId: 5 }
  }
  // El docTipo legacy permite 80, 86, 96, 99. wsfe acepta 80 | 96 | 99.
  // Si llega 86 (CUIL), lo mapeamos a 96 (DNI) defensivamente — si algún
  // emisor necesita CUIL hay que extender el tipo de wsfe. Documentado.
  const docTipo = r.documento.tipo === 86 ? 96 : r.documento.tipo
  return {
    docTipo,
    docNro: r.documento.nro,
    condicionIVAReceptorId: r.condIva,
  }
}

/**
 * Traduce `ItemFacturado[]` legacy → `ItemFacturaInput[]` de wsfe.
 *
 * El mapeo es directo: el caller (server action) ya prorrateó precios
 * según la regla inviolable. wsfe usa estos items solo para sanity-check
 * (suma de subtotales == montoFacturado, ±0.01).
 */
function traducirItems(items: ItemFacturado[]): ItemFacturaInput[] {
  return items.map((i) => ({
    cantidad: i.cantidad,
    precioUnitarioConIva: i.precioUnitarioFacturado,
    subtotalConIva: i.subtotalFacturado,
  }))
}

// ============================================================
// Helpers de fecha
// ============================================================

/**
 * Convierte el formato AFIP `'yyyymmdd'` → ISO `'yyyy-mm-dd'`.
 *
 * AFIP siempre devuelve `caeFchVto` y `cbteFch` SIN guiones (8 dígitos).
 * Si llega con otro shape (con guiones, vacío, no numérico), throw —
 * indica un bug en el caller o un cambio de contrato AFIP que hay que
 * detectar temprano.
 *
 * @throws Error si `s` no es exactamente 8 dígitos
 */
export function convertirCaeFchVtoADate(s: string): string {
  if (!/^\d{8}$/.test(s)) {
    throw new Error(
      `caeFchVto inválido: "${s}" (esperado yyyymmdd, 8 dígitos sin separador)`,
    )
  }
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/**
 * Parsea fecha ISO `'yyyy-mm-dd'` a Date. Setea hora al mediodía
 * Argentina (12:00 -03:00 = 15:00 UTC) para evitar drift de zona
 * horaria en el round-trip yyyy-mm-dd → Date → yyyy-mm-dd.
 *
 * @throws Error si `s` no matchea el formato esperado
 */
function parseFechaIso(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`fechaEmision inválida: "${s}" (esperado yyyy-mm-dd)`)
  }
  // 12:00 Argentina = 15:00 UTC (UTC-3). Mediodía evita que cualquier
  // ±12h de offset cambie el día.
  return new Date(`${s}T15:00:00.000Z`)
}

// ============================================================
// Traducción de resultado/error
// ============================================================

/**
 * Traduce un `ResultadoEmisionFactura` (shape nuevo de wsfe) al
 * `ResultadoFactura` legacy (rama de éxito). Pura — sin side effects.
 *
 * Exportada para testabilidad: el adapter construido sobre módulos ESM
 * hace difícil stubear `emitirFactura` desde tests; testear esta
 * función pura cubre la lógica de traducción de éxito sin necesitar
 * monkey-patching.
 */
export function traducirResultadoEmision(
  r: ResultadoEmisionFactura,
): ResultadoFactura {
  return {
    ok: true,
    cae: r.cae,
    caeVencimiento: convertirCaeFchVtoADate(r.caeFchVto),
    numeroComprobante: r.cbteNro,
    resultado: r.resultado,
    observaciones: r.observaciones.length > 0 ? r.observaciones : undefined,
    rawResponse: {
      cae: r.cae,
      caeFchVto: r.caeFchVto,
      cbteNro: r.cbteNro,
      resultado: r.resultado,
      observaciones: r.observaciones,
    },
  }
}

/**
 * Traduce un error genérico (`AfipWsfeError` o `Error`) al
 * `ResultadoFactura` legacy (rama de error). Pura.
 *
 * - `AfipWsfeError` con códigos catalogados → mensaje desde el catálogo
 *   (`mensaje. remediacion`, una línea por código separadas por '\n').
 *   Quien consume `error` es el admin de caja (no la vendedora), así
 *   que sumar la remediación lo orienta a resolver sin pedir ayuda.
 *   Si el código no está catalogado, `traducirErrorAfip` devuelve el
 *   mensaje crudo de AFIP — lo incluimos igual sin marcar nada extra.
 * - `AfipWsfeError` SIN códigos (network, parse error, validación local) →
 *   se mantiene `err.message` para no perder info técnica útil.
 * - Cualquier otro Error → `err.message` plano, `rawResponse: undefined`.
 *
 * `rawResponse` mantiene los códigos crudos para que la UI o auditoría
 * los pueda usar (no se pierde nada respecto del comportamiento previo).
 */
export function traducirErrorAdaptador(err: unknown): ResultadoFactura {
  if (err instanceof AfipWsfeError) {
    const codigos = err.contexto.codigosError ?? []
    const mensajes = err.contexto.mensajesError ?? []

    let errorMensaje: string
    if (codigos.length > 0) {
      const lineas = codigos.map((codigo, idx) => {
        const mensajeCrudo = mensajes[idx] ?? ''
        const traducido = traducirErrorAfip(codigo, mensajeCrudo)
        return traducido.remediacion
          ? `${traducido.mensaje}. ${traducido.remediacion}`
          : traducido.mensaje
      })
      errorMensaje = lineas.join('\n')
    } else {
      errorMensaje = err.message
    }

    return {
      ok: false,
      error: errorMensaje,
      rawResponse: {
        metodo: err.contexto.metodo,
        codigosError: err.contexto.codigosError ?? null,
        mensajesError: err.contexto.mensajesError ?? null,
        severidadMaxima: err.severidadMaxima,
      },
    }
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : 'Error desconocido en AFIP',
    rawResponse: undefined,
  }
}

// ============================================================
// Adapter
// ============================================================

export const adaptadorReal: AdaptadorAfip = {
  nombre: 'real',

  async emitir(input: DatosFacturaInput): Promise<ResultadoFactura> {
    try {
      const cbteTipo = traducirTipoFactura(input.tipoFactura)
      const receptor = traducirReceptor(input.receptor)
      const items = traducirItems(input.items)
      const fecha = parseFechaIso(input.fechaEmision)

      const r: ResultadoEmisionFactura = await emitirFactura({
        empresaId: input.empresaId,
        puntoVenta: input.puntoVenta,
        cbteTipo,
        fechaComprobante: fecha,
        montoFacturado: input.montoTotal,
        receptor,
        items,
        comprobanteAsociado: input.comprobanteAsociado,
        onRequestLogged: input.onRequestLogged,
      })

      return traducirResultadoEmision(r)
    } catch (err) {
      return traducirErrorAdaptador(err)
    }
  },

  async consultarUltimoComprobante(): Promise<ResultadoConsultaUltimo> {
    // Stub. El contrato legacy `(puntoVenta, tipoFactura)` no incluye
    // empresaId, requerido por la API nueva multi-tenant. El server
    // action no invoca este método. Si en el futuro algún caller lo
    // necesita, ampliar el contrato AdaptadorAfip y migrar todos los
    // adapters a la nueva firma.
    return {
      ok: false,
      error:
        'consultarUltimoComprobante no implementado en adaptador real (falta empresaId en contrato legacy)',
    }
  },

  async consultarComprobante(): Promise<ResultadoConsulta> {
    // Stub. Idem consultarUltimoComprobante + falta FECompConsultar
    // (Fase 4.b.2). Sin callers reales hoy.
    return {
      ok: false,
      error:
        'consultarComprobante no implementado en adaptador real (Fase 4.b.2 con FECompConsultar)',
    }
  },

  async healthcheck(): Promise<ResultadoHealthcheck> {
    // Stub. El contrato legacy no recibe empresaId, requerido por
    // wsfe.healthcheck para auditar la llamada por empresa. El server
    // action no invoca este método. El smoke test usa wsfe.healthcheck
    // directo. Devolvemos OK opt-in para indicar que el adapter está
    // vivo (no que AFIP está vivo — eso requeriría llamada real).
    return {
      ok: true,
      mensaje:
        'adaptador real activo (healthcheck legacy stub — usar smoke contra AFIP para test real)',
    }
  },
}
