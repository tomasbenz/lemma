/**
 * Tipos compartidos de clientes.
 * Separados de clientes.ts (queries con supabase/server) para poder
 * importarlos desde Client Components sin arrastrar el server code.
 */

export type CondIva = 'RI' | 'MONO' | 'CF' | 'EX'

export type Cliente = {
  id: string
  razon_social: string
  cuit: string | null
  cond_iva: CondIva
  email: string | null
  telefono: string | null
  domicilio: string | null
  localidad: string | null
  provincia: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type ClienteConStats = Cliente & {
  cantidad_ventas: number
  monto_total_vendido: number
}

export type ListarClientesOptions = {
  q?: string
  soloActivos?: boolean
  orden?: 'nombre_asc' | 'nombre_desc' | 'fecha_desc'
  limit?: number
  offset?: number
}

/**
 * Helper: label humano para cond_iva.
 * Pure function, safe para client y server.
 */
export function labelCondIva(cond: CondIva): string {
  switch (cond) {
    case 'RI':
      return 'Responsable Inscripto'
    case 'MONO':
      return 'Monotributo'
    case 'CF':
      return 'Consumidor Final'
    case 'EX':
      return 'Exento'
  }
}