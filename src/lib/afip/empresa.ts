import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Resolución de la CUIT representada de una empresa para llamadas AFIP.
 *
 * Distinción clave:
 * - CUIT del computador: identifica al sistema cliente ante AFIP. Está en
 *   el certificado X.509 (cert.subject) y en la env var AFIP_CUIT. Lo usa
 *   WSAA implícitamente al verificar la firma del CMS.
 * - CUIT representada: identifica a la empresa POR LA CUAL operamos en
 *   cada llamada de negocio (WSFE, WSFEX, etc.). Va en Auth.Cuit del
 *   request SOAP.
 *
 * El vínculo computador → representadas se establece en WSASS (homo) o
 * en "Administrador de Relaciones de Clave Fiscal" (prod). Si mandamos
 * en Auth.Cuit la CUIT del computador en lugar de la representada,
 * AFIP responde:
 *   "ValidacionDeToken: No apareció CUIT en lista de relaciones: {cuit}"
 *
 * En el schema de Lemma la CUIT vive en la tabla `configuracion`
 * (1-a-1 con `empresas` vía empresa_id), junto con razon_social,
 * condicion_iva, domicilio, puntos_venta y demás datos fiscales que
 * Fase 4.b va a necesitar para FECAESolicitar.
 */

/**
 * Obtiene la CUIT representada (la de la empresa) desde la base.
 *
 * Devuelve la CUIT como string de 11 dígitos sin separadores, lista para
 * inyectar en el envelope SOAP.
 *
 * @throws Error si no hay configuración o la CUIT está mal formada.
 */
export async function obtenerCuitEmpresa(empresaId: string): Promise<string> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('configuracion')
    .select('cuit')
    .eq('empresa_id', empresaId)
    .single()

  if (error) {
    // .single() con cero filas retorna error.code === 'PGRST116', así que
    // el caso "no existe configuración" entra acá. No hay branch separado
    // para data === null porque sería inalcanzable.
    throw new Error(
      `No se pudo obtener CUIT de empresa ${empresaId}: ${error.message}`
    )
  }

  // Normalizar: sacar guiones, espacios o cualquier separador.
  const cuitNormalizada = String(data.cuit).replace(/\D/g, '')
  if (!/^\d{11}$/.test(cuitNormalizada)) {
    throw new Error(
      `CUIT mal formada en configuracion.cuit para empresa ${empresaId}: "${data.cuit}" (esperado 11 dígitos)`
    )
  }

  return cuitNormalizada
}
