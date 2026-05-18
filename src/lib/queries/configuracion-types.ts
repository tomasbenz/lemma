// src/lib/queries/configuracion-types.ts

export type Configuracion = {
  razon_social: string
  /**
   * Nombre comercial / de fantasía para mostrar en UI y PDFs (header).
   * Si es null, se usa `razon_social` como fallback. La razón social legal
   * sigue siendo el dato fiscal en facturas.
   */
  nombre_fantasia: string | null
  cuit: string
  condicion_iva: string
  ingresos_brutos: string | null
  inicio_actividades: string | null
  domicilio: string | null
  localidad: string | null
  provincia: string | null
  codigo_postal: string | null
  telefono: string | null
  email: string | null
  web: string | null
  /**
   * Punto de venta por defecto (legacy, se mantiene sincronizado con puntos_venta[0]).
   * @deprecated Usar puntos_venta[0]. Se mantiene por compatibilidad con AFIP.
   */
  punto_venta_default: number
  /**
   * Lista de puntos de venta habilitados en AFIP.
   * El primero del array es el default que se usa al emitir factura.
   * Mínimo 1 elemento. Cada uno entre 1 y 99999.
   */
  puntos_venta: number[]
  /**
   * Umbral por debajo del cual una variante se considera "stock bajo"
   * en alertas y reportes. Default 5.
   */
  umbral_stock_bajo: number
  updated_at: string
}