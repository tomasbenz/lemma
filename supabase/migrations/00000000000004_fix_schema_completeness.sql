-- ============================================================================
-- Lemma — Fixes retroactivos al schema
-- ============================================================================
--
-- Migration de paridad: incluye parches que ya fueron aplicados manualmente
-- al Supabase de Lemma (jmfieelwgjbsucwthgww) pero que NO estaban en las
-- migraciones 000–003 del repo. Sin esta migration, un setup fresh contra
-- una DB nueva queda incompleto respecto al estado real de producción.
--
-- Todos los DDL son idempotentes (IF NOT EXISTS / CREATE OR REPLACE) para
-- que aplicarla a la DB actual sea no-op.
--
-- Origen del drift:
--   * El código usa `clientes.notas`, `clientes.password_hash` y
--     `clientes.email_verificado` (componentes de cliente CRUD y, a futuro,
--     auth de cliente final). El init no las creó.
--   * El listado de ventas en `src/lib/queries/ventas.ts` consume la vista
--     `ventas_con_resumen` con columnas agregadas `items_count` (count de
--     items_venta por venta) e `items_cantidad_total` (suma de cantidades).
--     El init no creó la vista.
--
-- Estado de la DB de Lemma al momento de generar esta migration:
--   * `clientes.notas`, `clientes.password_hash`, `clientes.email_verificado`
--     YA EXISTEN (parche manual).
--   * `ventas_con_resumen` YA EXISTE (parche manual).
--
-- Aplicación: Tomás puede aplicarla sin riesgo (es no-op contra la DB de
-- Lemma actual). Para nuevos environments, la migration consolida los
-- parches dentro de las migraciones versionadas del repo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOQUE A — Columnas faltantes en `clientes`
-- ----------------------------------------------------------------------------

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS notas text;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS password_hash text;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS email_verificado boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- BLOQUE B — Vista `ventas_con_resumen`
-- ----------------------------------------------------------------------------
-- Expone las columnas de la tabla `ventas` que el listado/búsqueda de ventas
-- de admin necesita, MÁS dos agregaciones precalculadas a items_venta:
--   - items_count          → cantidad de filas de items_venta por venta.
--   - items_cantidad_total → suma de items_venta.cantidad por venta.
--
-- CREATE OR REPLACE VIEW es safe: si la vista ya existe con el mismo shape,
-- la sobreescribe sin tocar dependencias (RLS/queries en curso). Si la vista
-- pre-existente tiene un shape distinto, OR REPLACE falla y Tomás debería
-- DROP VIEW + CREATE manualmente.

CREATE OR REPLACE VIEW public.ventas_con_resumen AS
SELECT
  v.id,
  v.numero,
  v.canal,
  v.usuario_id,
  v.cliente_id,
  v.empresa_id,
  v.estado,
  v.tipo_factura,
  v.estado_facturacion_afip,
  v.subtotal_neto,
  v.descuento_total,
  v.total,
  v.monto_facturado,
  v.recargo_factura_completa,
  v.recargo_porcentaje_manual,
  v.recargo_motivo,
  v.nombre_cliente_custom,
  v.nota_interna,
  v.closed_at,
  v.vista_at,
  v.created_at,
  v.updated_at,
  COALESCE(
    (SELECT count(*)::int FROM public.items_venta iv WHERE iv.venta_id = v.id),
    0
  ) AS items_count,
  COALESCE(
    (SELECT SUM(iv.cantidad)::int FROM public.items_venta iv WHERE iv.venta_id = v.id),
    0
  ) AS items_cantidad_total
FROM public.ventas v;

-- ----------------------------------------------------------------------------
-- BLOQUE D — Reload del schema cache de PostgREST
-- ----------------------------------------------------------------------------
-- Para que /rest/v1 vea los cambios sin tener que reiniciar la instancia.

NOTIFY pgrst, 'reload schema';
