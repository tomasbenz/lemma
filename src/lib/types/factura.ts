/**
 * Tipo binario de facturación usado en la UI de cobro y finalización
 * de pedidos. El backend deriva el tipo real (factura_a/b/c) desde el
 * cond_iva del cliente — la UI solo decide si se factura o no.
 *
 * Para el tipo completo del enum de DB (factura_a, factura_b, etc.),
 * ver TipoFactura en components/app/badge-factura.tsx o
 * Database["public"]["Enums"]["tipo_factura"] en types/database.ts.
 */
export type TipoFacturaUI = 'sin_factura' | 'con_factura'
