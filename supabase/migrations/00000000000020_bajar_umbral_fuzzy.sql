-- ============================================================================
-- 00000000000020_bajar_umbral_fuzzy.sql
-- ----------------------------------------------------------------------------
-- Tras la 019 (normalizar_busqueda elimina espacios), la similitud de queries
-- desordenadas como 'Kangaro o o o o' → 'kangarooooo' bajó (de 0.307 a 0.172
-- contra 'brocheskangaro23/10...'). El threshold 0.2 dejaba esos casos afuera.
--
-- Bajamos el DEFAULT de p_umbral a 0.12. El smart fallback de queries < 3
-- chars (LIKE substring) sigue protegiendo del ruido.
--
-- Único cambio respecto de la 013: el DEFAULT del parámetro p_umbral
-- (0.2 → 0.12). El cuerpo es idéntico. No hace falta DROP: CREATE OR REPLACE
-- permite cambiar el DEFAULT (la firma no cambia).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
  p_query text,
  p_umbral real DEFAULT 0.12
)
RETURNS TABLE(producto_id uuid, sim real)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
DECLARE
  v_norm text;
  v_empresa_id uuid;
BEGIN
  -- Auth + empresa derivada (igual que antes).
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
  IF length(v_norm) = 0 THEN RETURN; END IF;

  IF length(v_norm) < 3 THEN
    RETURN QUERY
      SELECT p.id AS producto_id, 1.0::real AS sim
      FROM public.productos p
      WHERE p.empresa_id = v_empresa_id
        AND p.busqueda_normalizada LIKE '%' || v_norm || '%'
      LIMIT 1000;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id AS producto_id, similarity(p.busqueda_normalizada, v_norm) AS sim
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id
      AND similarity(p.busqueda_normalizada, v_norm) >= p_umbral
    ORDER BY sim DESC, p.nombre
    LIMIT 1000;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) TO authenticated;

DO $$
DECLARE v_func integer;
BEGIN
  SELECT count(*) INTO v_func
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_productos_ids';
  IF v_func <> 1 THEN
    RAISE EXCEPTION 'buscar_productos_ids: se esperaba 1, hay %', v_func;
  END IF;
  RAISE NOTICE 'OK: buscar_productos_ids con umbral default 0.12.';
END;
$$;
