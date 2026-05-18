import 'server-only'
import * as forge from 'node-forge'

/**
 * Firma el XML TRA usando el certificado y la clave privada del contribuyente,
 * en formato CMS/PKCS#7 (Cryptographic Message Syntax).
 *
 * El resultado es un string base64 que se envía a WSAA en el campo `in0`
 * del SOAP envelope de LoginCms.
 *
 * Por qué CMS/PKCS#7:
 * - AFIP requiere específicamente este formato para verificar que el TRA
 *   fue firmado por el dueño del certificado registrado.
 * - El CMS contiene tanto el contenido firmado (el TRA) como los metadatos
 *   de firma (algoritmo, certificado, signed attributes).
 *
 * Algoritmo de firma: SHA-256 con RSA. AFIP acepta SHA-1 también pero
 * SHA-256 es el estándar moderno.
 */

export type ParametrosFirmaTra = {
  /** XML TRA generado por tra-builder */
  traXml: string
  /** Certificado en formato PEM (con headers BEGIN/END CERTIFICATE) */
  certPem: string
  /** Clave privada en formato PEM (con headers BEGIN/END PRIVATE KEY) */
  keyPem: string
}

/**
 * Firma el TRA y devuelve el CMS en base64.
 *
 * @throws Error si el cert o la key tienen formato inválido
 */
export function firmarTra(params: ParametrosFirmaTra): string {
  const { traXml, certPem, keyPem } = params

  // Parsear cert
  let cert: forge.pki.Certificate
  try {
    cert = forge.pki.certificateFromPem(certPem)
  } catch (err) {
    throw new Error(
      `No se pudo parsear el certificado PEM: ${err instanceof Error ? err.message : 'error desconocido'}`
    )
  }

  // Parsear key privada
  let privateKey: forge.pki.PrivateKey
  try {
    privateKey = forge.pki.privateKeyFromPem(keyPem)
  } catch (err) {
    throw new Error(
      `No se pudo parsear la clave privada PEM: ${err instanceof Error ? err.message : 'error desconocido'}`
    )
  }

  // Crear el contenido a firmar
  const p7 = forge.pkcs7.createSignedData()

  // El contenido es el TRA XML como bytes UTF-8
  p7.content = forge.util.createBuffer(traXml, 'utf8')

  // Adjuntar el certificado (AFIP necesita verificar la firma con él)
  p7.addCertificate(cert)

  // Agregar el signer con SHA-256
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
        // node-forge calcula automáticamente el digest del contenido
      },
      {
        type: forge.pki.oids.signingTime,
        // node-forge auto-popula con new Date() si omitimos el value
        // (ver node_modules/node-forge/lib/pkcs7.js:514-518). Lo dejamos
        // sin value para evitar el bug de tipado en @types/node-forge
        // que declara `value?: string` cuando runtime acepta Date.
      },
    ],
  })

  // Firmar (detached: false significa que el contenido va incluido en el CMS)
  p7.sign({ detached: false })

  // Convertir a DER (binario) y luego a base64
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  const base64 = forge.util.encode64(der)

  return base64
}
