import 'server-only'
import { XMLParser } from 'fast-xml-parser'

/**
 * Capa de parsing XML para el módulo WSFE.
 *
 * Reemplazo del parser regex que vivía adentro de parsers.ts. Usamos
 * fast-xml-parser para manejar correctamente:
 * - Self-closing tags (<Tag/>) que el regex viejo no veía.
 * - Bloques <Errors> con N elementos <Err> (el regex viejo solo
 *   agarraba el primero).
 * - Caracteres especiales en CDATA y entities (&lt;, &amp;) que el
 *   regex no desescapaba en algunos paths.
 * - Estructuras anidadas que Fase 4.b va a necesitar (FECAESolicitar
 *   tiene FeCabResp + FeDetResp + Errors + Observaciones todos en el
 *   mismo response).
 *
 * Esta capa NO se usa para WSAA: ese módulo mantiene su parser regex
 * local porque su única respuesta (LoginCms) es estable y trivial, y
 * tocarla obliga a ejercer LoginCms en cada test (rate-limit AFIP).
 */

/**
 * Instancia de XMLParser configurada para respuestas WSFE.
 *
 * Decisiones de config y por qué:
 * - removeNSPrefix: true → AFIP responde con prefijos variables
 *   (soap:, soapenv:, sin prefijo). Normalizamos a sin prefijo para
 *   navegar siempre por los mismos nombres ('Envelope', 'Body',
 *   'FECompUltimoAutorizadoResult', etc.).
 * - parseTagValue: false → fast-xml-parser por default convierte
 *   "0" → 0, "true" → true, etc. Lo apagamos: TODO viene como string,
 *   los parsers convierten explícito con parseInt + Number.isNaN.
 *   Mismo patrón que la versión regex; evita sorpresas con strings
 *   tipo "10E5" que se interpretan como 1000000.
 * - ignoreAttributes: true → AFIP no usa atributos relevantes en
 *   respuestas WSFE (solo xmlns, que removeNSPrefix maneja). Si en
 *   Fase 4.b descubrimos atributos útiles (ej. xsi:nil="true" para
 *   campos opcionales), revertir esta opción.
 * - trimValues: true → AFIP devuelve respuestas con whitespace e
 *   indentación. Sin esto, '   OK   ' !== 'OK'.
 */
export const wsfeXmlParser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  ignoreAttributes: true,
  trimValues: true,
})

/**
 * Normaliza el resultado de fast-xml-parser cuando un nodo puede venir
 * como objeto (1 elemento), array (N elementos), o ausente.
 *
 * - null/undefined → []
 * - objeto → [objeto]
 * - array → array sin tocar
 *
 * Crítico para procesar collections como <Errors><Err>...</Err></Errors>:
 * fast-xml-parser colapsa array de un elemento a objeto. Si AFIP devuelve
 * un solo Err (caso típico en homologación), sin este helper el código
 * se rompe en runtime con "Err.map is not a function".
 *
 * Existe la opción `isArray` de fast-xml-parser para forzar array por
 * path, pero requiere config-driven y es frágil cuando se agregan
 * nuevos métodos. Helper en runtime es más explícito y local al call.
 */
export function aArray<T>(valor: T | T[] | null | undefined): T[] {
  if (valor === null || valor === undefined) return []
  return Array.isArray(valor) ? valor : [valor]
}

/**
 * Parsea un importe AFIP a number.
 *
 * Acepta:
 * - "121.00" (formato esperado en WSFE: punto como separador decimal)
 * - "121,00" (defensivo: por si AFIP cambia de criterio o algún proxy
 *   reformatea según locale)
 * - "121" (sin decimales)
 * - "" o whitespace → 0 (caso edge: tag presente pero vacío)
 *
 * Throw si después de normalizar no parsea como número finito.
 *
 * Usado por `parseFECompConsultarResponse` para `ImpTotal`. Si en el
 * futuro otros parsers necesitan leer importes, reusar este helper
 * en lugar de duplicar la lógica.
 */
export function parseImporteAfip(s: string): number {
  if (!s || s.trim() === '') return 0
  const normalizado = s.replace(',', '.').trim()
  const n = Number(normalizado)
  if (!Number.isFinite(n)) {
    throw new Error(`Importe AFIP inválido: "${s}"`)
  }
  return n
}

/**
 * Navega un path tipo 'Envelope.Body.FECompUltimoAutorizadoResponse' en
 * el objeto que devuelve fast-xml-parser, devolviendo undefined si algún
 * tramo no existe.
 *
 * Sin este helper los parsers se llenan de optional chaining
 * ilegible: `x?.Envelope?.Body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult`.
 * Con esto: `navegarPath(x, 'Envelope.Body.FECompUltimoAutorizadoResponse.FECompUltimoAutorizadoResult')`.
 *
 * NO es type-safe: el caller hace narrowing con `typeof`/`instanceof` o
 * con un cast comentado donde aplique.
 */
export function navegarPath(obj: unknown, path: string): unknown {
  const tramos = path.split('.')
  let actual: unknown = obj
  for (const tramo of tramos) {
    if (actual === null || actual === undefined || typeof actual !== 'object') {
      return undefined
    }
    actual = (actual as Record<string, unknown>)[tramo]
  }
  return actual
}
