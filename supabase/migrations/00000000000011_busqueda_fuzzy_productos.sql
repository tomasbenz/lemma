-- ============================================================================
-- 00000000000011_busqueda_fuzzy_productos.sql
-- ----------------------------------------------------------------------------
-- Búsqueda fuzzy de productos (tolera typos, tildes, mayúsculas y espacios
-- sobrantes). Caso real: "Kangaro o o o o" debe encontrar "Kangaroo".
--
-- Estrategia: pg_trgm + unaccent.
--   * Columna generada `busqueda_normalizada` = lower + sin tildes + espacios
--     colapsados de (nombre + sku_base + categoria).
--   * Índice GIN gin_trgm_ops sobre esa columna.
--   * RPC buscar_productos_ids(empresa, query, umbral) → ids ordenados por
--     similaridad. PostgREST no expone el operador `%` de pg_trgm, por eso va
--     como RPC (no inline en supabase-js).
--
-- DECISIONES:
--   * Umbral 0.3 hardcoded (default del param).
--   * Smart fallback: queries < 3 chars usan LIKE substring (no degradar SKUs).
--   * unaccent es STABLE → no se puede usar en columna GENERATED ni indexar;
--     se envuelve en immutable_unaccent (patrón canónico, dict explícito).
--
-- NOTA: la caja (POS offline) y los editores de pedido/venta filtran en el
-- cliente (IndexedDB / array cargado); esos usan el helper JS src/lib/search/
-- fuzzy.ts (no esta RPC). Esta migración cubre solo las búsquedas server-side.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 11.1 Extensiones
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ----------------------------------------------------------------------------
-- 11.2 Wrapper IMMUTABLE de unaccent (unaccent es STABLE)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.immutable_unaccent(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT public.unaccent('public.unaccent', $1)
$function$;

-- ----------------------------------------------------------------------------
-- 11.3 Normalizador (lower + sin tildes + espacios colapsados)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalizar_busqueda(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT regexp_replace(
    lower(public.immutable_unaccent(coalesce(t, ''))),
    '\s+', ' ', 'g'
  )
$function$;

-- ----------------------------------------------------------------------------
-- 11.4 Columna generada + índice GIN
-- ----------------------------------------------------------------------------

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS busqueda_normalizada text
  GENERATED ALWAYS AS (
    public.normalizar_busqueda(
      nombre || ' ' || coalesce(sku_base, '') || ' ' || coalesce(categoria, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS productos_busqueda_idx
  ON public.productos
  USING GIN (busqueda_normalizada gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 11.5 RPC de búsqueda
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
  p_query text,
  p_umbral real DEFAULT 0.3
)
RETURNS TABLE(id uuid, sim real)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
DECLARE
  v_norm text;
  v_empresa_id uuid;
BEGIN
  -- ===== Auth + empresa_id derivada (no se confía en el cliente) =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = auth.uid() AND activo = true;

  IF NOT FOUND OR v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado o sin empresa';
  END IF;

  v_norm := public.normalizar_busqueda(p_query);
  IF length(v_norm) = 0 THEN
    RETURN;
  END IF;

  -- Smart fallback: queries cortas usan substring para no degradar SKUs.
  IF length(v_norm) < 3 THEN
    RETURN QUERY
      SELECT p.id, 1.0::real AS sim
      FROM public.productos p
      WHERE p.empresa_id = v_empresa_id
        AND p.busqueda_normalizada LIKE '%' || v_norm || '%'
      LIMIT 1000;
    RETURN;
  END IF;

  -- Fuzzy: índice GIN + ranking por similaridad.
  RETURN QUERY
    SELECT p.id, similarity(p.busqueda_normalizada, v_norm) AS sim
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id
      AND p.busqueda_normalizada % v_norm
      AND similarity(p.busqueda_normalizada, v_norm) >= p_umbral
    ORDER BY sim DESC, p.nombre
    LIMIT 1000;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_ext integer;
  v_col integer;
  v_idx integer;
  v_func integer;
BEGIN
  SELECT count(*) INTO v_ext
  FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent');

  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos'
    AND column_name = 'busqueda_normalizada';

  SELECT count(*) INTO v_idx
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'productos_busqueda_idx';

  SELECT count(*) INTO v_func
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_productos_ids';

  IF v_ext <> 2 THEN
    RAISE EXCEPTION 'Faltan extensiones pg_trgm/unaccent (encontradas: %)', v_ext;
  END IF;
  IF v_col <> 1 THEN
    RAISE EXCEPTION 'No se creó la columna busqueda_normalizada (encontradas: %)', v_col;
  END IF;
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'No se creó el índice productos_busqueda_idx (encontrados: %)', v_idx;
  END IF;
  IF v_func <> 1 THEN
    RAISE EXCEPTION 'buscar_productos_ids: se esperaba 1 función, hay %', v_func;
  END IF;

  RAISE NOTICE 'OK: pg_trgm + unaccent + columna busqueda_normalizada + índice GIN + RPC buscar_productos_ids.';
END;
$$;
