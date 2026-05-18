-- ============================================================
-- Fix: indice unique de "una factura aprobada por venta" debe excluir
-- NC/ND, sino bloquea la persistencia del UPDATE final cuando AFIP
-- aprueba la NC.
--
-- Bug detectado el 10-may-2026: al anular una venta con factura B
-- aprobada, AFIP emitia la NC con CAE valido, pero el UPDATE en DB
-- fallaba con error:
--   "duplicate key value violates unique constraint
--    idx_facturas_afip_una_aprobada_por_venta"
--
-- Causa: el indice unique solo filtraba por estado='aprobada' pero NO
-- por factura_asociada_id IS NULL. Por lo tanto, cuando una NC
-- (factura_asociada_id NOT NULL) se intentaba pasar a estado='aprobada',
-- chocaba con la factura original aprobada de la misma venta.
--
-- Fix: agregar AND factura_asociada_id IS NULL al WHERE del indice.
-- Asi solo aplica a facturas originales, permitiendo que NC/ND
-- aprobadas convivan con su factura original aprobada (esquema fiscal
-- correcto: una venta con factura + N notas de credito/debito).
--
-- Sin esto, el flujo de anulacion via emitir-nota-credito-afip.ts
-- entra al fallback de 'aprobada_sin_persistir' aunque AFIP haya
-- aprobado la NC correctamente.
--
-- Ya aplicado manualmente en Supabase Cloud — este archivo deja la
-- migration en repo para que cualquier instalacion futura quede
-- consistente.
-- ============================================================

DROP INDEX IF EXISTS public.idx_facturas_afip_una_aprobada_por_venta;

CREATE UNIQUE INDEX idx_facturas_afip_una_aprobada_por_venta
ON public.facturas_afip (venta_id)
WHERE estado = 'aprobada' AND factura_asociada_id IS NULL;

COMMENT ON INDEX idx_facturas_afip_una_aprobada_por_venta IS
  'Garantiza maximo 1 factura ORIGINAL aprobada por venta. Excluye NC/ND (factura_asociada_id NOT NULL) que pueden ser N aprobadas asociadas a la misma factura original.';
