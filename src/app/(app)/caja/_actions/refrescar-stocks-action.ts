'use server'

import { refrescarStocksVariantes } from '@/lib/queries/refrescar-stocks'

export type RefrescoStock = {
  varianteId: string
  stockActual: number
}

/**
 * Server Action: devuelve stocks actuales para la lista de IDs provista.
 * Usado por el modal de cobro para validar antes de cerrar venta.
 */
export async function refrescarStocksCarrito(
  varianteIds: string[]
): Promise<RefrescoStock[]> {
  const mapa = await refrescarStocksVariantes(varianteIds)
  return Array.from(mapa.entries()).map(([varianteId, stockActual]) => ({
    varianteId,
    stockActual,
  }))
}