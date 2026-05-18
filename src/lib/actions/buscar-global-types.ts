/**
 * Tipos compartidos para búsqueda global (command palette).
 */

export type ProductoGlobal = {
  id: string
  nombre: string
  sku_base: string
  imagen_url: string | null
  categoria: string | null
}

export type VentaGlobal = {
  id: string
  numero: number
  fecha: string
  cliente: string
  /** Total cobrado real (precios netos, sin sumar IVA encima). */
  total: number
}
