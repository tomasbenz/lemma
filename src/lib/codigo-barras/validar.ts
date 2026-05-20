/**
 * Helpers para códigos de barras en la caja.
 *
 * Modo B: escaneamos códigos de fábrica ya impresos en los productos (EAN-8,
 * EAN-13, UPC-12, GTIN-14). No exigimos check digit porque los códigos de
 * proveedores pueden no respetar EAN estricto.
 */

/**
 * Trim + colapsa espacios internos. Los lectores USB suelen "tipear" el código
 * de un saque, pero si el operador pega algo a mano puede entrar con espacios.
 */
export function normalizarCodigoBarras(codigo: string): string {
  return codigo.trim().replace(/\s+/g, '')
}

/**
 * Heurística para decidir si una string parece un código de barras y disparar
 * el flujo de scan. Acepta 8 a 18 dígitos para cubrir EAN-8/EAN-13/UPC-12/
 * GTIN-14 sin descartar variantes raras de proveedores.
 */
export function pareceCodigoBarras(valor: string): boolean {
  const limpio = normalizarCodigoBarras(valor)
  return /^\d{8,18}$/.test(limpio)
}
