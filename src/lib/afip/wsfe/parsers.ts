import 'server-only'
import type {
  ResultadoHealthcheckWsfe,
  ResultadoConsultarUltimo,
  ResultadoEmisionFactura,
  ResultadoConsultaComprobante,
  ObservacionAfip,
  TipoComprobanteAfip,
} from './types'
import { AfipWsfeError } from './types'
import {
  traducirErrorAfip,
  type ErrorAfipTraducido,
  type SeveridadErrorAfip,
} from '@/lib/afip/errors'
import { aArray, navegarPath, parseImporteAfip, wsfeXmlParser } from './xml-parser'

/**
 * Parsers de respuestas XML de WSFE.
 *
 * Reemplazo del parser regex (Fase 4.b.0). Ahora usamos fast-xml-parser
 * a través del helper `wsfeXmlParser` (ver xml-parser.ts).
 *
 * Comportamiento observable IDÉNTICO al regex anterior:
 * - SOAP Fault → AfipWsfeError sin traducidos.
 * - <Errors> → AfipWsfeError con traducidos vía traducirErrorAfip,
 *   mensaje legible "AFIP código N: ...", severidadMaxima derivada.
 * - Campos requeridos faltantes → AfipWsfeError 'incompleta'.
 * - Valores no numéricos donde se esperan ints → throw.
 *
 * Ganancias vs regex viejo:
 * - Self-closing tags (<Tag/>) se manejan correctamente. Antes el regex
 *   los ignoraba.
 * - <Errors> con N elementos <Err>: ahora capturamos todos. Antes solo
 *   el primero.
 * - Entities y caracteres especiales en <Msg>: la lib desescapa.
 */

/**
 * Parsea respuesta de FEDummy.
 * @throws AfipWsfeError si la respuesta no tiene el shape esperado
 */
export function parseFEDummyResponse(xml: string): ResultadoHealthcheckWsfe {
  const arbol = parsearXmlOFalla(xml, 'FEDummy')

  // Detectar SOAP Fault primero
  const fault = extraerSoapFault(arbol)
  if (fault) {
    throw new AfipWsfeError(
      `WSFE FEDummy SOAP Fault: ${fault}`,
      { metodo: 'FEDummy', raw: xml.substring(0, 500) }
    )
  }

  // Path: Envelope.Body.FEDummyResponse.FEDummyResult
  const result = navegarPath(arbol, 'Envelope.Body.FEDummyResponse.FEDummyResult')
  if (!esObjeto(result)) {
    throw new AfipWsfeError(
      'Respuesta FEDummy incompleta: falta FEDummyResult',
      { metodo: 'FEDummy', raw: xml.substring(0, 500) }
    )
  }

  const appServer = leerStringObligatorio(result, 'AppServer', 'FEDummy', xml)
  const dbServer = leerStringObligatorio(result, 'DbServer', 'FEDummy', xml)
  const authServer = leerStringObligatorio(result, 'AuthServer', 'FEDummy', xml)

  return {
    appServer: appServer === 'OK' ? 'OK' : 'ERROR',
    dbServer: dbServer === 'OK' ? 'OK' : 'ERROR',
    authServer: authServer === 'OK' ? 'OK' : 'ERROR',
  }
}

/**
 * Parsea respuesta de FECompUltimoAutorizado.
 * @throws AfipWsfeError si hay SOAP Fault o si AFIP devuelve Errors collection
 */
export function parseFECompUltimoAutorizadoResponse(
  xml: string,
): ResultadoConsultarUltimo {
  const arbol = parsearXmlOFalla(xml, 'FECompUltimoAutorizado')

  // 1. SOAP Fault
  const fault = extraerSoapFault(arbol)
  if (fault) {
    throw new AfipWsfeError(
      `WSFE FECompUltimoAutorizado SOAP Fault: ${fault}`,
      { metodo: 'FECompUltimoAutorizado', raw: xml.substring(0, 500) }
    )
  }

  const result = navegarPath(
    arbol,
    'Envelope.Body.FECompUltimoAutorizadoResponse.FECompUltimoAutorizadoResult',
  )
  if (!esObjeto(result)) {
    throw new AfipWsfeError(
      'Respuesta FECompUltimoAutorizado incompleta: falta FECompUltimoAutorizadoResult',
      { metodo: 'FECompUltimoAutorizado', raw: xml.substring(0, 500) }
    )
  }

  // 2. Errors collection (puede venir incluso con HTTP 200)
  const errors = extraerErrorsDeResult(result)
  if (errors.length > 0) {
    const codigos = errors.map((e) => e.codigo)
    const mensajes = errors.map((e) => e.mensaje)
    const traducidos = errors.map((e) => traducirErrorAfip(e.codigo, e.mensaje))
    const mensajePrincipal = formatearMensajeErroresTraducidos(traducidos)

    throw new AfipWsfeError(
      mensajePrincipal,
      {
        metodo: 'FECompUltimoAutorizado',
        codigosError: codigos,
        mensajesError: mensajes,
        raw: xml.substring(0, 500),
      },
      traducidos
    )
  }

  // 3. Parse de campos esperados
  const ptoVtaStr = leerStringObligatorio(result, 'PtoVta', 'FECompUltimoAutorizado', xml)
  const cbteTipoStr = leerStringObligatorio(result, 'CbteTipo', 'FECompUltimoAutorizado', xml)
  const cbteNroStr = leerStringObligatorio(result, 'CbteNro', 'FECompUltimoAutorizado', xml)

  const ptoVta = parseInt(ptoVtaStr, 10)
  const cbteTipo = parseInt(cbteTipoStr, 10) as TipoComprobanteAfip
  const cbteNro = parseInt(cbteNroStr, 10)

  if (Number.isNaN(ptoVta) || Number.isNaN(cbteTipo) || Number.isNaN(cbteNro)) {
    throw new AfipWsfeError(
      `Respuesta FECompUltimoAutorizado con valores no numéricos: PtoVta=${ptoVtaStr}, CbteTipo=${cbteTipoStr}, CbteNro=${cbteNroStr}`,
      { metodo: 'FECompUltimoAutorizado', raw: xml.substring(0, 500) }
    )
  }

  return {
    puntoVenta: ptoVta,
    tipoComprobante: cbteTipo,
    numeroComprobante: cbteNro,
  }
}

/**
 * Parsea respuesta de FECAESolicitar.
 *
 * Estructura esperada (path desde root):
 *   Envelope.Body.FECAESolicitarResponse.FECAESolicitarResult
 *     ├── FeCabResp.Resultado: 'A' | 'R' | 'P'
 *     ├── FeDetResp.FECAEDetResponse[0]: detalle del comprobante con CAE
 *     └── Errors.Err[]: errores a nivel cabecera (raros pero posibles)
 *
 * Casos de error:
 * - SOAP Fault → AfipWsfeError sin traducidos.
 * - <Errors> a nivel Result → AfipWsfeError con códigos del diccionario.
 * - FECAEDetResponse.Resultado = 'R' → AfipWsfeError con observaciones
 *   del detalle clasificadas con `clasificarSeveridadObservacionFecae`.
 * - FeCabResp.Resultado = 'P' → AfipWsfeError "parcial no esperado"
 *   (solo aplica con CantReg>1 que no usamos).
 *
 * Caso éxito:
 * - FECAEDetResponse.Resultado = 'A' → extrae CAE + CAEFchVto + CbteDesde.
 *   `Observaciones` (warnings) pueden venir igual; se devuelven en el
 *   `ResultadoEmisionFactura.observaciones` para auditoría.
 *
 * @throws AfipWsfeError en cualquier path de error
 */
export function parseFECAESolicitarResponse(
  xml: string,
): ResultadoEmisionFactura {
  const arbol = parsearXmlOFalla(xml, 'FECAESolicitar')

  // 1. SOAP Fault
  const fault = extraerSoapFault(arbol)
  if (fault) {
    throw new AfipWsfeError(
      `WSFE FECAESolicitar SOAP Fault: ${fault}`,
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  const result = navegarPath(
    arbol,
    'Envelope.Body.FECAESolicitarResponse.FECAESolicitarResult',
  )
  if (!esObjeto(result)) {
    throw new AfipWsfeError(
      'Respuesta FECAESolicitar incompleta: falta FECAESolicitarResult',
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  // 2. Errors collection a nivel Result (errores que no llegaron a procesar
  //    el detalle: auth invalid, schema bad, etc.)
  const errors = extraerErrorsDeResult(result)
  if (errors.length > 0) {
    const codigos = errors.map((e) => e.codigo)
    const mensajes = errors.map((e) => e.mensaje)
    const traducidos = errors.map((e) => traducirErrorAfip(e.codigo, e.mensaje))
    throw new AfipWsfeError(
      formatearMensajeErroresTraducidos(traducidos),
      {
        metodo: 'FECAESolicitar',
        codigosError: codigos,
        mensajesError: mensajes,
        raw: xml.substring(0, 500),
      },
      traducidos,
    )
  }

  // 3. FeCabResp.Resultado: A (todo aprobado), R (todo rechazado), P (parcial)
  const cabResp = navegarPath(result, 'FeCabResp')
  if (!esObjeto(cabResp)) {
    throw new AfipWsfeError(
      'Respuesta FECAESolicitar incompleta: falta FeCabResp',
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }
  const resultadoCab = leerStringObligatorio(cabResp, 'Resultado', 'FECAESolicitar', xml)

  if (resultadoCab === 'P') {
    // Parcial solo aplica con CantReg>1. Como emitimos de a una, no
    // debería ocurrir; si pasa, AFIP tiene un comportamiento inesperado.
    throw new AfipWsfeError(
      'FECAESolicitar resultado parcial (P) no esperado — emitimos CantReg=1',
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  // 4. FeDetResp.FECAEDetResponse — emitimos CantReg=1, así que esperamos
  //    exactamente 1 detalle. fast-xml-parser puede colapsar a objeto.
  const detResp = navegarPath(result, 'FeDetResp')
  if (!esObjeto(detResp)) {
    throw new AfipWsfeError(
      'Respuesta FECAESolicitar incompleta: falta FeDetResp',
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }
  const detalles = aArray(detResp.FECAEDetResponse)
  const detalle = detalles[0]
  if (!esObjeto(detalle)) {
    throw new AfipWsfeError(
      'Respuesta FECAESolicitar incompleta: falta FECAEDetResponse',
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  const resultadoDet = leerStringObligatorio(detalle, 'Resultado', 'FECAESolicitar', xml)
  const observaciones = extraerObservacionesDeDetalle(detalle)

  // 5. Detalle rechazado: throw con observaciones clasificadas
  if (resultadoDet === 'R') {
    const traducidos: ErrorAfipTraducido[] = observaciones.map((o) => ({
      codigo: o.codigo,
      mensaje: o.mensaje,
      grupo: 'validacion',
      severidad: clasificarSeveridadObservacionFecae(o.codigo),
      esConocido: true,
    }))
    throw new AfipWsfeError(
      `FECAESolicitar rechazado: ${formatearMensajeErroresTraducidos(traducidos)}`,
      {
        metodo: 'FECAESolicitar',
        codigosError: observaciones.map((o) => o.codigo),
        mensajesError: observaciones.map((o) => o.mensaje),
        raw: xml.substring(0, 500),
      },
      traducidos,
    )
  }

  // 6. Aprobado: extraer CAE, CAEFchVto, CbteDesde
  if (resultadoDet !== 'A') {
    throw new AfipWsfeError(
      `FECAESolicitar Resultado de detalle inesperado: "${resultadoDet}" (esperaba A o R)`,
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  const cae = leerStringObligatorio(detalle, 'CAE', 'FECAESolicitar', xml)
  const caeFchVto = leerStringObligatorio(detalle, 'CAEFchVto', 'FECAESolicitar', xml)
  const cbteDesdeStr = leerStringObligatorio(detalle, 'CbteDesde', 'FECAESolicitar', xml)
  const cbteNro = parseInt(cbteDesdeStr, 10)
  if (Number.isNaN(cbteNro)) {
    throw new AfipWsfeError(
      `FECAESolicitar CbteDesde no es numérico: "${cbteDesdeStr}"`,
      { metodo: 'FECAESolicitar', raw: xml.substring(0, 500) }
    )
  }

  return {
    cae,
    caeFchVto,
    cbteNro,
    resultado: 'A',
    observaciones,
  }
}

/**
 * Parsea respuesta de FECompConsultar.
 *
 * AFIP devuelve uno de tres estados:
 *
 * 1. **Comprobante NO existe** → respuesta sin `ResultGet` poblado
 *    (puede venir como `Errors` collection o `ResultGet` vacío sin
 *    `CodAutorizacion`). Devolvemos `{ existe: false }`.
 *
 *    El código de error AFIP típico para "no existe" es 602 ("No existen
 *    datos en nuestros archivos"), pero AFIP puede devolver otros códigos
 *    según el caso. Para no atarnos a un código específico, detectamos
 *    "no existe" por **AUSENCIA de `ResultGet.CodAutorizacion` poblado**
 *    en lugar de matchear códigos de error.
 *
 *    APPROACH PRÁCTICO (Sprint 1): toda respuesta sin ResultGet poblado
 *    se trata como "no existe", incluso si vienen Errors. Si el smoke
 *    documenta que AFIP a veces devuelve errores reales (no "no existe")
 *    en este path, refinaremos el filtro mirando códigos específicos.
 *
 * 2. **Comprobante existe** → `ResultGet` con CAE no vacío. Extraemos
 *    CAE, FchVto, CbteDesde, Resultado, ImpTotal, Observaciones.
 *
 * 3. **Error de transporte** → SOAP Fault → throw AfipWsfeError permanente.
 *
 * Spec: WSFEv1.5.8.4, sección FECompConsultar.
 *
 * @throws AfipWsfeError en SOAP Fault o respuesta malformada irreparable
 */
export function parseFECompConsultarResponse(
  xml: string,
): ResultadoConsultaComprobante {
  const arbol = parsearXmlOFalla(xml, 'FECompConsultar')

  // 1. SOAP Fault → throw (mismo patrón que parseFECAESolicitarResponse)
  const fault = extraerSoapFault(arbol)
  if (fault) {
    throw new AfipWsfeError(
      `WSFE FECompConsultar SOAP Fault: ${fault}`,
      { metodo: 'FECompConsultar', raw: xml.substring(0, 500) }
    )
  }

  // 2. Navegar hasta FECompConsultarResult
  const result = navegarPath(
    arbol,
    'Envelope.Body.FECompConsultarResponse.FECompConsultarResult',
  )
  if (!esObjeto(result)) {
    throw new AfipWsfeError(
      'Respuesta FECompConsultar incompleta: falta FECompConsultarResult',
      { metodo: 'FECompConsultar', raw: xml.substring(0, 500) }
    )
  }

  // 3. Detectar "no existe" por ausencia de ResultGet poblado.
  //    Si Errors collection viene poblado, lo logueamos para que el smoke
  //    pueda documentar los códigos reales que AFIP devuelve cuando "no
  //    existe". No threwamos: tratamos como no-existe (approach pragmático
  //    Sprint 1 — refinar si el smoke muestra errores reales en este path).
  const resultGet = result.ResultGet
  const codAutorizacion = esObjeto(resultGet)
    ? aString(resultGet.CodAutorizacion)
    : null

  if (!esObjeto(resultGet) || codAutorizacion === null || codAutorizacion === '') {
    const errors = extraerErrorsDeResult(result)
    if (errors.length > 0) {
      console.log(
        '[AFIP/WSFE] FECompConsultar sin ResultGet, AFIP devolvió Errors:',
        errors.map((e) => `${e.codigo}: ${e.mensaje}`).join(' | '),
      )
    }
    return { existe: false }
  }

  // 4. ResultGet poblado → comprobante existe. Extraer campos.
  const caeFchVto = leerStringObligatorio(resultGet, 'FchVto', 'FECompConsultar', xml)
  const cbteDesdeStr = leerStringObligatorio(resultGet, 'CbteDesde', 'FECompConsultar', xml)
  const resultadoStr = leerStringObligatorio(resultGet, 'Resultado', 'FECompConsultar', xml)
  const impTotalStr = leerStringObligatorio(resultGet, 'ImpTotal', 'FECompConsultar', xml)

  const cbteNro = parseInt(cbteDesdeStr, 10)
  if (Number.isNaN(cbteNro)) {
    throw new AfipWsfeError(
      `FECompConsultar CbteDesde no es numérico: "${cbteDesdeStr}"`,
      { metodo: 'FECompConsultar', raw: xml.substring(0, 500) }
    )
  }

  if (resultadoStr !== 'A' && resultadoStr !== 'R' && resultadoStr !== 'P') {
    throw new AfipWsfeError(
      `FECompConsultar Resultado inesperado: "${resultadoStr}" (esperaba A, R o P)`,
      { metodo: 'FECompConsultar', raw: xml.substring(0, 500) }
    )
  }
  const resultado: 'A' | 'R' | 'P' = resultadoStr

  let impTotal: number
  try {
    impTotal = parseImporteAfip(impTotalStr)
  } catch (err) {
    const detalle = err instanceof Error ? err.message : 'error desconocido'
    throw new AfipWsfeError(
      `FECompConsultar ImpTotal inválido: ${detalle}`,
      { metodo: 'FECompConsultar', raw: xml.substring(0, 500) }
    )
  }

  const observaciones = extraerObservacionesDeResultGet(resultGet)

  return {
    existe: true,
    cae: codAutorizacion,
    caeFchVto,
    cbteNro,
    resultado,
    impTotal,
    observaciones,
  }
}

/**
 * Extrae <Observaciones><Obs><Code/><Msg/></Obs></Observaciones> del
 * ResultGet de FECompConsultar. Mismo shape que en FECAESolicitar pero
 * vive un nivel arriba (ResultGet en lugar de FECAEDetResponse).
 */
function extraerObservacionesDeResultGet(
  resultGet: Record<string, unknown>,
): ObservacionAfip[] {
  const obsBlock = resultGet.Observaciones
  if (!esObjeto(obsBlock)) return []

  const obs = aArray(obsBlock.Obs)
  const lista: ObservacionAfip[] = []
  for (const o of obs) {
    if (!esObjeto(o)) continue
    const codeStr = aString(o.Code)
    const msg = aString(o.Msg)
    if (codeStr === null || msg === null) continue
    const codigo = parseInt(codeStr, 10)
    if (!Number.isNaN(codigo)) {
      lista.push({ codigo, mensaje: msg })
    }
  }
  return lista
}

/**
 * Mapeo de códigos de Observaciones de FECAESolicitar a severidad interna.
 *
 * Las Observaciones de AFIP en el detalle (Resultado='R') son distintas de
 * los errores del diccionario (`errors.ts`): vienen con códigos a veces
 * duplicados pero con semántica de "validación de negocio puntual".
 *
 * - 10015 (DocNro inválido), 10016 (DocTipo no válido para el receptor),
 *   10017 (DocTipo+DocNro inconsistentes con padrón) → requiere_admin
 *   (datos del cliente mal cargados; el admin tiene que corregirlos).
 * - 10063, 10064 (importes no cuadran con totales) → permanente (bug
 *   en el cálculo del caller; reintentar no lo arregla).
 * - Resto sin clasificar → permanente por default conservador.
 *
 * Si aparecen códigos nuevos en la práctica, ampliar este mapeo.
 */
function clasificarSeveridadObservacionFecae(codigo: number): SeveridadErrorAfip {
  if (codigo === 10015 || codigo === 10016 || codigo === 10017) {
    return 'requiere_admin'
  }
  if (codigo === 10063 || codigo === 10064) {
    return 'permanente'
  }
  return 'permanente'
}

/**
 * Extrae <Observaciones><Obs><Code/><Msg/></Obs></Observaciones> de un
 * FECAEDetResponse. Pueden venir como warnings con resultado='A' o como
 * errores con resultado='R'.
 */
function extraerObservacionesDeDetalle(
  detalle: Record<string, unknown>,
): Array<{ codigo: number; mensaje: string }> {
  const obsBlock = detalle.Observaciones
  if (!esObjeto(obsBlock)) return []

  const obs = aArray(obsBlock.Obs)
  const lista: Array<{ codigo: number; mensaje: string }> = []
  for (const o of obs) {
    if (!esObjeto(o)) continue
    const codeStr = aString(o.Code)
    const msg = aString(o.Msg)
    if (codeStr === null || msg === null) continue
    const codigo = parseInt(codeStr, 10)
    if (!Number.isNaN(codigo)) {
      lista.push({ codigo, mensaje: msg })
    }
  }
  return lista
}

/**
 * Construye un mensaje legible a partir de los errores traducidos.
 * Si el código está en el diccionario, usa la versión traducida + remediación.
 * Si no, marca explícitamente "código no mapeado" con el mensaje crudo de AFIP.
 * Para múltiples errores, los une con ' | '.
 */
function formatearMensajeErroresTraducidos(
  traducidos: readonly ErrorAfipTraducido[],
): string {
  return traducidos
    .map((t) => {
      if (t.esConocido) {
        const remediacion = t.remediacion ? ` ${t.remediacion}` : ''
        return `AFIP código ${t.codigo}: ${t.mensaje}.${remediacion}`
      }
      return `AFIP código ${t.codigo}: ${t.mensaje} (código no mapeado)`
    })
    .join(' | ')
}

/**
 * Wrappea `wsfeXmlParser.parse` capturando errores de parser y elevándolos
 * a `AfipWsfeError` con severidad permanente.
 *
 * fast-xml-parser puede lanzar si el XML está seriamente roto (ej. tags
 * mal cerrados, content binario, JSON en el body por un proxy). Sin este
 * wrap, el throw burbujea como `Error` genérico — `esErrorReintentableAfip`
 * no lo reconoce y el caller no obtiene `severidadMaxima`.
 *
 * Decisión: errores de XML schema NO son reintentables (pedirle a AFIP
 * que mande otra vez no arregla el XML). Sin tercer argumento al
 * constructor → `severidadMaxima` cae al default 'permanente' del getter.
 */
function parsearXmlOFalla(xml: string, metodo: string): unknown {
  try {
    return wsfeXmlParser.parse(xml)
  } catch (err) {
    const detalle = err instanceof Error ? err.message : 'error desconocido'
    throw new AfipWsfeError(
      `WSFE ${metodo} respuesta XML malformada: ${detalle}`,
      { metodo, raw: xml.substring(0, 500) }
    )
  }
}

/**
 * Detecta SOAP Fault en el árbol parseado.
 * Path estándar SOAP: Envelope.Body.Fault.faultstring (+ faultcode opcional).
 */
function extraerSoapFault(arbol: unknown): string | null {
  const fault = navegarPath(arbol, 'Envelope.Body.Fault')
  if (!esObjeto(fault)) return null

  const faultstring = aString(fault.faultstring)
  if (!faultstring) return null

  const faultcode = aString(fault.faultcode) ?? 'unknown'
  return `${faultcode}: ${faultstring}`
}

/**
 * Extrae todos los <Err><Code>...<Msg>...</Err> dentro del Result indicado.
 * Si no hay <Errors> o no contiene <Err>, devuelve [].
 *
 * AFIP devuelve <Errors><Err><Code/>... uno o varios. fast-xml-parser
 * colapsa array de un elemento a objeto, así que aplicamos `aArray`
 * antes de mapear (ver xml-parser.ts).
 */
function extraerErrorsDeResult(
  result: Record<string, unknown>,
): Array<{ codigo: number; mensaje: string }> {
  const errorsBlock = result.Errors
  if (!esObjeto(errorsBlock)) return []

  const errs = aArray(errorsBlock.Err)
  const errores: Array<{ codigo: number; mensaje: string }> = []

  for (const err of errs) {
    if (!esObjeto(err)) continue
    const codeStr = aString(err.Code)
    const msg = aString(err.Msg)
    if (codeStr === null || msg === null) continue
    const codigo = parseInt(codeStr, 10)
    if (!Number.isNaN(codigo)) {
      errores.push({ codigo, mensaje: msg })
    }
  }

  return errores
}

/**
 * Lee un campo de un objeto que debe ser string no-vacío. Si no está o
 * viene como '' (tag vacío en XML), throw 'incompleta' uniforme.
 *
 * fast-xml-parser puede devolver:
 * - undefined → tag ausente o self-closing (<Tag/>)
 * - '' → tag presente pero sin contenido (<Tag></Tag>)
 * Ambos los tratamos igual: respuesta incompleta.
 */
function leerStringObligatorio(
  obj: Record<string, unknown>,
  campo: string,
  metodo: string,
  rawXml: string,
): string {
  const valor = aString(obj[campo])
  if (valor === null || valor === '') {
    throw new AfipWsfeError(
      `Respuesta ${metodo} incompleta: falta o está vacío el campo ${campo}`,
      { metodo, raw: rawXml.substring(0, 500) }
    )
  }
  return valor
}

/**
 * Coerción defensiva: convierte un valor desconocido a string si es
 * representable, o null. Útil porque parseTagValue:false hace que todo
 * venga como string, pero el typing de fast-xml-parser es `unknown`.
 *
 * - string → ese string
 * - number/bigint → toString (defensivo, no debería ocurrir con
 *   parseTagValue:false, pero no cuesta)
 * - resto → null (incluyendo objetos, arrays, undefined, null)
 */
function aString(valor: unknown): string | null {
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor)
  return null
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
