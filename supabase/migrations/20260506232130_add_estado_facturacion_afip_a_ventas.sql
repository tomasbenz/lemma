-- ============================================================
-- MIGRATION: estado_facturacion_afip en ventas
-- Fecha: 2026-05-06 (UTC)
-- ============================================================
--
-- Trackea el resultado del proceso de emisión electrónica AFIP por venta.
--
-- Distinción importante con columnas existentes:
-- - ventas.estado (enum venta_estado): estado del flujo de venta
--   ('abierta' | 'guardada' | 'cerrada' | 'anulada')
-- - ventas.tipo_factura (enum tipo_factura): qué tipo de comprobante
--   se eligió ('sin_factura' | 'factura_a' | 'factura_c')
-- - ventas.estado_facturacion_afip (NUEVO): resultado del intento de
--   emisión electrónica.
--
-- Una venta cerrada con tipo_factura='factura_a' puede estar:
-- - emitida (CAE OK) → próxima fila en `facturas`
-- - pendiente_facturacion (AFIP rechazó con error reintentable)
-- - error_permanente (AFIP rechazó con error definitivo, requiere
--   acción del admin: reintentar manualmente, cambiar tipo, anular).
--
-- Workflow de admin (Fase 4.b lo va a usar):
-- - pendiente_facturacion → admin reintenta o investiga el log.
-- - error_permanente → admin debe decidir explícitamente cómo proceder.
-- ============================================================

CREATE TYPE public.estado_facturacion_afip AS ENUM (
  'no_aplica',                -- sin_factura → no hay nada que emitir
  'pendiente_emision',        -- factura asignada, todavía no se intentó emitir
  'emitida',                  -- CAE obtenido, factura registrada en `facturas`
  'pendiente_facturacion',    -- intentamos emitir, AFIP rechazó con error reintentable agotado
  'error_permanente'          -- AFIP rechazó con error que no se va a resolver retrying
);

ALTER TABLE public.ventas
  ADD COLUMN estado_facturacion_afip public.estado_facturacion_afip NOT NULL DEFAULT 'no_aplica',
  ADD COLUMN ultimo_request_log_id bigint REFERENCES public.afip_request_log(id) ON DELETE SET NULL,
  ADD COLUMN ultimo_error_facturacion text,
  ADD COLUMN ultimo_intento_facturacion_at timestamptz;

-- Backfill: ventas con tipo_factura != 'sin_factura' y ya cerradas/guardadas
-- arrancan en 'pendiente_emision'. Fase 4.b se encargará de moverlas a
-- 'emitida' o lo que corresponda según el resultado de la emisión.
UPDATE public.ventas
   SET estado_facturacion_afip = 'pendiente_emision'
 WHERE tipo_factura <> 'sin_factura'
   AND estado IN ('cerrada', 'guardada');

-- Index parcial para la query del admin "pendientes de revisar":
-- típicamente listar las ventas que requieren intervención manual,
-- ordenadas por fecha de último intento.
CREATE INDEX ventas_pendientes_facturacion_idx
  ON public.ventas(empresa_id, ultimo_intento_facturacion_at DESC)
  WHERE estado_facturacion_afip IN ('pendiente_facturacion', 'error_permanente');

COMMENT ON COLUMN public.ventas.estado_facturacion_afip IS
  'Estado del intento de emisión electrónica AFIP. NO es el estado de la venta (ver ventas.estado). El admin puede reintentar manualmente cuando está en pendiente_facturacion o cambiar tipo_factura cuando está en error_permanente.';

COMMENT ON COLUMN public.ventas.ultimo_request_log_id IS
  'FK al último intento de emisión registrado en afip_request_log. Útil para que el admin abra ese log y vea el XML/error completos. Se setea con ON DELETE SET NULL: si el log se purga (TTL 90d), la venta no se rompe.';
