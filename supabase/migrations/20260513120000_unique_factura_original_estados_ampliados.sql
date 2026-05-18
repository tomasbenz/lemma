-- ============================================================
-- Ampliar UNIQUE INDEX de factura original por venta para cubrir
-- estados adicionales: aprobada_sin_persistir y anulada_por_nc.
--
-- Contexto (finding HIGH #2 de auditoria 184dc76):
-- El indice actual (`idx_facturas_afip_una_aprobada_por_venta`,
-- introducido en 20260510210000) solo filtra `estado='aprobada'`.
-- Eso deja agujero:
--
--   - Si la venta tiene una factura en 'aprobada_sin_persistir' (caso
--     de recovery: AFIP devolvio CAE pero el UPDATE en DB fallo y
--     marcamos asi para reconciliacion manual), un segundo intento
--     podria pasar de 'pendiente' a 'aprobada' SIN chocar — quedando
--     dos comprobantes fiscales para la misma venta.
--
--   - Si la venta tiene una factura 'anulada_por_nc' (la original que
--     fue anulada con una NC posterior), un reintento de facturacion
--     volveria a emitir otra original — ilegal fiscalmente. La NC
--     "ocupa" el slot fiscal de esa venta hasta que se rehaga
--     correctamente.
--
-- Estados que entran al UNIQUE:
--   - 'aprobada': CAE valido vivo
--   - 'aprobada_sin_persistir': CAE valido en AFIP pero UPDATE fallo
--   - 'anulada_por_nc': estuvo viva, ya fue corregida con NC
--
-- Estados que NO entran (pueden coexistir multiples por venta):
--   - 'pendiente': aun no emitido, sin compromiso fiscal
--   - 'rechazada': AFIP no aprobo nada
--   - 'error': crash tecnico, no hay comprobante
--
-- factura_asociada_id IS NULL: el indice sigue limitandose a
-- facturas ORIGINALES. Las NC/ND (factura_asociada_id NOT NULL)
-- pueden ser N por venta (no las afecta este indice).
-- ============================================================

DROP INDEX IF EXISTS public.idx_facturas_afip_una_aprobada_por_venta;

CREATE UNIQUE INDEX idx_facturas_afip_una_aprobada_por_venta
ON public.facturas_afip (venta_id)
WHERE estado IN ('aprobada', 'aprobada_sin_persistir', 'anulada_por_nc')
  AND factura_asociada_id IS NULL;

COMMENT ON INDEX idx_facturas_afip_una_aprobada_por_venta IS
  'Garantiza maximo 1 factura ORIGINAL fiscalmente "viva" por venta (aprobada / aprobada_sin_persistir / anulada_por_nc). Excluye NC/ND (factura_asociada_id NOT NULL) y estados no fiscales (pendiente/rechazada/error). Mitiga race condition de dos clicks simultaneos en emitir-factura-afip.';
