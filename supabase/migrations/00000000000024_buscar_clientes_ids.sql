-- ============================================================================
-- 00000000000024_buscar_clientes_ids.sql
-- ----------------------------------------------------------------------------
-- Búsqueda fuzzy de clientes por razón social (tolera typos, tildes,
-- mayúsculas y espacios sobrantes). Espejo de buscar_productos_ids
-- (migraciones 011/013/019/020), para /admin/clientes.
--
-- DECISIONES (y desvíos deliberados respecto del sketch del ticket):
--   * Normalización vía public.normalizar_busqueda() (IMMUTABLE, ya existe
--     desde la 011/019), NO lower(unaccent(...)): unaccent es STABLE y no
--     puede usarse en un índice por expresión. Además así la semántica es
--     idéntica a productos y al helper JS (src/lib/search/fuzzy.ts).
--   * Columna de salida `cliente_id` (no `id`): RETURNS TABLE(id ...) choca
--     con clientes.id dentro del cuerpo y el planner tira "column reference
--     'id' is ambiguous" — mismo bug que la 013 ya arregló en productos.
--   * SIN filtro c.activo = true: igual que productos, el caller aplica
--     soloActivos sobre los ids devueltos. /admin/clientes con estado=todos
--     busca también inactivos; hardcodearlo acá rompería esa vista.
--   * Umbral default 0.2 (más alto que productos, 0.12): razones sociales
--     cortas → más riesgo de falsos positivos.
--   * LIMIT 200 (productos usa 1000): la lista de clientes es más chica.
--   * Solo razon_social: CUIT y email se siguen filtrando con ilike en el
--     caller (substring exacto tiene más sentido para esos campos).
--   * Sin operador % de pg_trgm (igual que la 020): % usa el threshold
--     GLOBAL de pg_trgm (0.3 default), que pisaría nuestro 0.2. El scan
--     filtrado por empresa_id es barato en tablas de clientes.
--
-- NOTA: pg_trgm + unaccent ya están instaladas desde la 011. No se re-crean;
-- el guard de abajo verifica que existan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 24.1 Índice GIN por expresión (sirve para el fallback LIKE de queries
--      cortas; el branch fuzzy escanea filtrado por empresa, igual que la 020)
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS clientes_busqueda_idx
  ON public.clientes
  USING GIN (public.normalizar_busqueda(razon_social) gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 24.2 RPC de búsqueda
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buscar_clientes_ids(
  p_query text,
  p_umbral real DEFAULT 0.2
)
RETURNS TABLE(cliente_id uuid, score real)
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

  -- Smart fallback: queries cortas usan substring (no degradar 1-2 chars).
  IF length(v_norm) < 3 THEN
    RETURN QUERY
      SELECT c.id AS cliente_id, 1.0::real AS score
      FROM public.clientes c
      WHERE c.empresa_id = v_empresa_id
        AND public.normalizar_busqueda(c.razon_social) LIKE '%' || v_norm || '%'
      LIMIT 200;
    RETURN;
  END IF;

  -- Fuzzy: ranking por similaridad de trigramas.
  RETURN QUERY
    SELECT c.id AS cliente_id,
           similarity(public.normalizar_busqueda(c.razon_social), v_norm) AS score
    FROM public.clientes c
    WHERE c.empresa_id = v_empresa_id
      AND similarity(public.normalizar_busqueda(c.razon_social), v_norm) >= p_umbral
    ORDER BY score DESC, c.razon_social
    LIMIT 200;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.buscar_clientes_ids(text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_clientes_ids(text, real) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_ext integer;
  v_idx integer;
  v_func integer;
  v_norm text;
BEGIN
  SELECT count(*) INTO v_ext
  FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent');

  SELECT count(*) INTO v_idx
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'clientes_busqueda_idx';

  SELECT count(*) INTO v_func
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_clientes_ids';

  IF v_ext <> 2 THEN
    RAISE EXCEPTION 'Faltan extensiones pg_trgm/unaccent (encontradas: %)', v_ext;
  END IF;
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'No se creó el índice clientes_busqueda_idx (encontrados: %)', v_idx;
  END IF;
  IF v_func <> 1 THEN
    RAISE EXCEPTION 'buscar_clientes_ids: se esperaba 1 función, hay %', v_func;
  END IF;

  -- Sanity check del normalizador compartido (mismo contrato que el helper JS).
  SELECT public.normalizar_busqueda('Núñez  S.A.') INTO v_norm;
  IF v_norm <> 'nunezs.a.' THEN
    RAISE EXCEPTION 'normalizar_busqueda devolvió algo inesperado: %', v_norm;
  END IF;

  RAISE NOTICE 'OK: índice clientes_busqueda_idx + RPC buscar_clientes_ids (umbral 0.2, limit 200).';
END;
$$;
