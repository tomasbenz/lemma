-- ============================================================================
-- 00000000000013_busqueda_fuzzy_columna_ambigua.sql
-- Fix: "column reference 'id' is ambiguous" en buscar_productos_ids.
--
-- Detectado vía logs de Vercel: la RPC fallaba en runtime porque el
-- `RETURNS TABLE(id uuid, sim real)` declara una columna de salida `id` que
-- choca con `productos.id` dentro del cuerpo (el `SELECT p.id ...` se vuelve
-- ambiguo para el planner). Postgres lanzaba "column reference 'id' is
-- ambiguous"; el helper TS capturaba el error y devolvía [] silenciosamente,
-- por eso en la UI veíamos "no se encontraron productos" sin error visible.
--
-- Cambio respecto de la 012:
--   * La columna de salida `id` se renombra a `producto_id` (RETURNS TABLE y
--     los dos SELECT internos). Elimina la ambigüedad sin tocar la lógica.
--   * El helper TS pasa a mapear `.producto_id` en vez de `.id`.
--
-- Nota: renombrar una columna OUT cambia el row type de retorno, y Postgres no
-- lo permite vía CREATE OR REPLACE ("cannot change return type of existing
-- function"). Por eso se DROPea primero y se recrea.
-- ============================================================================

DROP FUNCTION IF EXISTS public.buscar_productos_ids(text, real);

CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
  p_query text,
  p_umbral real DEFAULT 0.2
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
  RAISE NOTICE 'OK: buscar_productos_ids fix ambiguedad columna id -> producto_id.';
END;
$$;
