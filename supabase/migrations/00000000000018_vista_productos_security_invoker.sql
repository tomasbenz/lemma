-- ============================================================================
-- 00000000000018_vista_productos_security_invoker.sql
-- ----------------------------------------------------------------------------
-- Fix de seguridad multi-tenant: la vista productos_con_stock_total era
-- creada SIN security_invoker, así que corría con permisos del owner
-- (postgres, superuser) y bypassaba RLS de productos. Cualquier usuario veía
-- productos de todas las empresas.
--
-- Esta migración pone security_invoker=true para que la vista respete la RLS
-- del usuario que la consulta (no del owner). PG15+ / Supabase lo soporta.
--
-- NOTA: usamos =true (no =on) porque es como Postgres lo persiste en
-- reloptions y permite verificación robusta del guard.
-- Idempotente: ALTER VIEW siempre setea el flag al estado deseado.
-- ============================================================================

ALTER VIEW public.productos_con_stock_total SET (security_invoker = true);

DO $$
DECLARE v_opts text;
BEGIN
  SELECT reloptions::text INTO v_opts
  FROM pg_class
  WHERE relname = 'productos_con_stock_total' AND relnamespace = 'public'::regnamespace;
  IF v_opts IS NULL OR v_opts NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'No se aplicó security_invoker (reloptions=%)', COALESCE(v_opts, 'NULL');
  END IF;
  RAISE NOTICE 'OK: productos_con_stock_total tiene security_invoker=true (reloptions=%)', v_opts;
END;
$$;
