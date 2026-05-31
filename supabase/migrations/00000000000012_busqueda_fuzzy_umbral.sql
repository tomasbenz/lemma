-- ============================================================================
-- 00000000000012_busqueda_fuzzy_umbral.sql
-- Baja el umbral de búsqueda fuzzy de 0.3 a 0.2 para captar matches en el
-- borde (caso real: "Kangaro o o o o o" → BROCHES KANGARO tiene sim=0.307,
-- pero el operador % a veces no lo matchea cerca del threshold default).
--
-- Cambios respecto de la 011:
--   * p_umbral default 0.2 (antes 0.3).
--   * Se elimina el operador `%` y el filtro depende SOLO de
--     `similarity(...) >= p_umbral` (determinístico en el borde).
--
-- Por qué no se usa `SET pg_trgm.similarity_threshold`: Supabase no permite a
-- la sesión `authenticated` setear ese GUC de extensión (permission denied).
-- Sin el `%`, el filtro explícito de similarity() no usa el índice GIN, pero
-- sí el btree de empresa_id; para el catálogo de una empresa (~miles de filas)
-- el seq-scan de similarity() es sub-segundo. El helper TS no cambia.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
  p_query text,
  p_umbral real DEFAULT 0.2
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

  -- Fuzzy: ranking por similaridad con umbral explícito (sin operador `%`,
  -- para no depender del GUC de sesión y ser determinístico en el borde).
  RETURN QUERY
    SELECT p.id, similarity(p.busqueda_normalizada, v_norm) AS sim
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id
      AND similarity(p.busqueda_normalizada, v_norm) >= p_umbral
    ORDER BY sim DESC, p.nombre
    LIMIT 1000;
END;
$function$;

-- Re-emitir permisos por idempotencia
REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) TO authenticated;

-- Guard
DO $$
DECLARE v_func integer;
BEGIN
  SELECT count(*) INTO v_func
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_productos_ids';
  IF v_func <> 1 THEN
    RAISE EXCEPTION 'buscar_productos_ids: se esperaba 1, hay %', v_func;
  END IF;
  RAISE NOTICE 'OK: buscar_productos_ids con umbral 0.2.';
END;
$$;
