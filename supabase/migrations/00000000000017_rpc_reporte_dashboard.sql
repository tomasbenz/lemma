-- ============================================================================
-- 00000000000017_rpc_reporte_dashboard.sql
-- ----------------------------------------------------------------------------
-- RPC consolidada del dashboard de Reportes (Fase 2). Devuelve en un solo jsonb
-- todas las secciones nuevas: ganancia + cobertura de costo, top productos por
-- monto y por cantidad, margen negativo, productos dormidos, ranking de marcas,
-- ventas por hora (zona AR) y ventas por vendedor.
--
-- Patrón: igual que reporte_ventas_agregado (migr 003): LANGUAGE sql, STABLE,
-- SECURITY INVOKER → la RLS de cada tabla limita por empresa del caller.
--
-- DECISIONES (relevamiento Fase 2):
--   * Costo ACTUAL (no histórico): items_venta no snapshotea costo; se joinea
--     productos.costo de hoy vía variante_id → variantes.producto_id. Margen y
--     ganancia se calculan sobre items con costo IS NOT NULL.
--   * Rango semiabierto [p_desde, p_hasta): se usa < p_hasta (el caller pasa el
--     inicio del día siguiente como límite).
--   * Filtro opcional por turno (p_turno_id).
--   * Ventas por hora en 'America/Argentina/Buenos_Aires' (created_at es UTC).
--   * Dormidos: stock > 0 (alguna variante activa) Y sin ventas en el rango,
--     vía NOT EXISTS (NULL-safe).
--
-- NUNCA aplicar a prod automáticamente — Tomás la corre.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reporte_dashboard(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_turno_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH
  -- Items de ventas cerradas en el rango, con producto + costo + marca.
  items_rango AS (
    SELECT
      iv.venta_id,
      iv.producto_nombre,
      iv.producto_sku,
      iv.cantidad,
      iv.precio_unitario_neto,
      iv.subtotal_neto,
      v.producto_id,
      p.costo,
      p.marca_id,
      m.nombre AS marca_nombre,
      ve.created_at AS venta_at
    FROM public.items_venta iv
    JOIN public.ventas ve ON ve.id = iv.venta_id
    JOIN public.variantes v ON v.id = iv.variante_id
    JOIN public.productos p ON p.id = v.producto_id
    LEFT JOIN public.marcas m ON m.id = p.marca_id
    WHERE ve.estado = 'cerrada'
      AND ve.created_at >= p_desde
      AND ve.created_at < p_hasta
      AND (p_turno_id IS NULL OR ve.turno_id = p_turno_id)
  ),

  -- Ganancia + cobertura de costo.
  ganancia AS (
    SELECT
      COALESCE(SUM(CASE WHEN costo IS NOT NULL
                        THEN (precio_unitario_neto - costo) * cantidad END), 0) AS monto,
      COUNT(*) FILTER (WHERE costo IS NOT NULL) AS items_con_costo,
      COUNT(*) AS items_total
    FROM items_rango
  ),

  -- Top 20 por monto facturado.
  top_monto AS (
    SELECT producto_id, producto_nombre, producto_sku,
           SUM(subtotal_neto) AS monto, SUM(cantidad) AS unidades
    FROM items_rango
    GROUP BY producto_id, producto_nombre, producto_sku
    ORDER BY monto DESC
    LIMIT 20
  ),

  -- Top 20 por cantidad.
  top_cantidad AS (
    SELECT producto_id, producto_nombre, producto_sku,
           SUM(cantidad) AS unidades, SUM(subtotal_neto) AS monto
    FROM items_rango
    GROUP BY producto_id, producto_nombre, producto_sku
    ORDER BY unidades DESC
    LIMIT 20
  ),

  -- Top 20 margen negativo (solo items con costo).
  margen_negativo AS (
    SELECT producto_id, producto_nombre, producto_sku,
           SUM((precio_unitario_neto - costo) * cantidad) AS margen,
           SUM(subtotal_neto) AS monto, SUM(cantidad) AS unidades
    FROM items_rango
    WHERE costo IS NOT NULL
    GROUP BY producto_id, producto_nombre, producto_sku
    HAVING SUM((precio_unitario_neto - costo) * cantidad) < 0
    ORDER BY margen ASC
    LIMIT 20
  ),

  -- Productos dormidos: stock > 0 y sin ventas en el rango (NOT EXISTS).
  dormidos AS (
    SELECT
      p.id AS producto_id,
      p.nombre AS producto_nombre,
      p.sku_base AS producto_sku,
      (SELECT SUM(stock)::bigint FROM public.variantes
        WHERE producto_id = p.id AND activa) AS stock_total
    FROM public.productos p
    WHERE p.empresa_id = public.get_empresa_id()
      AND p.activo = true
      AND EXISTS (
        SELECT 1 FROM public.variantes vv
        WHERE vv.producto_id = p.id AND vv.activa AND vv.stock > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM items_rango ir WHERE ir.producto_id = p.id
      )
    ORDER BY stock_total DESC NULLS LAST
    LIMIT 20
  ),

  -- Ranking de marcas por monto.
  ranking_marcas AS (
    SELECT
      marca_id,
      COALESCE(marca_nombre, '(Sin marca)') AS marca_nombre,
      SUM(subtotal_neto) AS monto,
      SUM(cantidad) AS unidades
    FROM items_rango
    GROUP BY marca_id, marca_nombre
    ORDER BY monto DESC
  ),

  -- Ventas por hora del día (0-23) en zona AR.
  ventas_por_hora AS (
    SELECT
      EXTRACT(HOUR FROM venta_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS hora,
      COUNT(DISTINCT venta_id) AS transacciones,
      SUM(subtotal_neto) AS monto
    FROM items_rango
    GROUP BY hora
    ORDER BY hora
  ),

  -- Ventas por vendedor (sobre ventas, no items).
  ventas_por_vendedor AS (
    SELECT
      u.id AS usuario_id,
      u.nombre_completo,
      COUNT(*) AS transacciones,
      SUM(ve.total) AS monto
    FROM public.ventas ve
    JOIN public.usuarios u ON u.id = ve.usuario_id
    WHERE ve.estado = 'cerrada'
      AND ve.created_at >= p_desde
      AND ve.created_at < p_hasta
      AND (p_turno_id IS NULL OR ve.turno_id = p_turno_id)
    GROUP BY u.id, u.nombre_completo
    ORDER BY monto DESC
  )

  SELECT jsonb_build_object(
    'ganancia', jsonb_build_object(
      'monto', (SELECT monto FROM ganancia),
      'items_con_costo', (SELECT items_con_costo FROM ganancia),
      'items_total', (SELECT items_total FROM ganancia),
      'cobertura_pct', CASE WHEN (SELECT items_total FROM ganancia) > 0
                            THEN ROUND(((SELECT items_con_costo FROM ganancia)::numeric
                                        / (SELECT items_total FROM ganancia)) * 100, 1)
                            ELSE 0 END
    ),
    'top_monto', COALESCE((SELECT jsonb_agg(t ORDER BY t.monto DESC) FROM top_monto t), '[]'::jsonb),
    'top_cantidad', COALESCE((SELECT jsonb_agg(t ORDER BY t.unidades DESC) FROM top_cantidad t), '[]'::jsonb),
    'margen_negativo', COALESCE((SELECT jsonb_agg(m ORDER BY m.margen ASC) FROM margen_negativo m), '[]'::jsonb),
    'dormidos', COALESCE((SELECT jsonb_agg(d ORDER BY d.stock_total DESC NULLS LAST) FROM dormidos d), '[]'::jsonb),
    'ranking_marcas', COALESCE((SELECT jsonb_agg(r ORDER BY r.monto DESC) FROM ranking_marcas r), '[]'::jsonb),
    'ventas_por_hora', COALESCE((SELECT jsonb_agg(v ORDER BY v.hora) FROM ventas_por_hora v), '[]'::jsonb),
    'ventas_por_vendedor', COALESCE((SELECT jsonb_agg(v ORDER BY v.monto DESC) FROM ventas_por_vendedor v), '[]'::jsonb)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.reporte_dashboard(timestamptz, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporte_dashboard(timestamptz, timestamptz, uuid) TO authenticated;

-- Guard
DO $$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reporte_dashboard';
  IF v <> 1 THEN
    RAISE EXCEPTION 'No se creó reporte_dashboard (%).', v;
  END IF;
  RAISE NOTICE 'OK: reporte_dashboard creada.';
END;
$$;
