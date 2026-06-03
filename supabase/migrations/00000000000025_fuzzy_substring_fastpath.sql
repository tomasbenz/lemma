-- ============================================================================
-- 00000000000025_fuzzy_substring_fastpath.sql
-- ----------------------------------------------------------------------------
-- Bug: /admin/productos?q=bic → 0 resultados (hay 68 productos Bic en Samu);
-- ?q=opaco → 0 (hay 7). El cliente (caja) los encuentra; la RPC no.
--
-- Causa estructural (verificada empíricamente contra el catálogo real):
-- pg_trgm.similarity() es Jaccard (intersección/unión) sobre trigramas, y
-- busqueda_normalizada NO tiene espacios (migración 019) → es una "word"
-- gigante para pg_trgm, así que los trigramas de borde del query ('  b',
-- ' bi', 'co ') solo existen al inicio/fin del string completo. Una
-- ocurrencia INTERIOR de "opaco" comparte apenas 3 trigramas contra una
-- unión de ~45 → sim ≈ 0.067, irrecuperable bajo el umbral 0.12. Bajar el
-- umbral NO arregla: con 0.05, "bic" recupera 7 de los 68 esperados.
--
-- Fix: fast-path substring, espejo EXACTO del helper cliente
-- (src/lib/search/fuzzy.ts, coincide(): `if (target.includes(query)) return
-- true` ANTES de los trigramas). Las dos RPCs pasan a:
--   WHERE <normalizado> LIKE '%query%' OR similarity(...) >= umbral
-- con CASE que da score 1.0 a los matches por substring → van primero en el
-- ranking, y los matches por trigram (typos) los siguen ordenados por sim.
-- El índice GIN gin_trgm_ops acelera también el LIKE.
--
-- Trade-off asumido: typos en queries cortas (ej. "bjc") siguen sin
-- matchear — el cliente tiene la misma limitación. Coherencia caja/admin
-- gana sobre cobertura extra.
--
-- buscar_clientes_ids se arregla PREVENTIVAMENTE: hoy funciona porque las
-- razones sociales son cortas (verificado: 0/25 clientes fallan buscados
-- por su primera palabra), pero tiene el mismo agujero latente para
-- razones largas.
--
-- Único cambio respecto de 020 (productos) y 024 (clientes): la rama fuzzy
-- (CASE + OR LIKE). Auth, rama corta <3 chars, normalización, LIMIT y
-- permisos quedan idénticos. La firma no cambia → CREATE OR REPLACE alcanza.
--
-- NO aplicar a la DB de prod automáticamente — Tomás la aplica a mano.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 25.1 buscar_productos_ids — fast-path substring
-- ----------------------------------------------------------------------------

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

  -- Smart fallback: queries cortas usan substring (no degradar SKUs).
  IF length(v_norm) < 3 THEN
    RETURN QUERY
      SELECT p.id AS producto_id, 1.0::real AS sim
      FROM public.productos p
      WHERE p.empresa_id = v_empresa_id
        AND p.busqueda_normalizada LIKE '%' || v_norm || '%'
      LIMIT 1000;
    RETURN;
  END IF;

  -- Fast-path substring (score 1.0, espejo de coincide() del cliente)
  -- + trigram para typos. Substring primero en el ranking.
  RETURN QUERY
    SELECT p.id AS producto_id,
           CASE WHEN p.busqueda_normalizada LIKE '%' || v_norm || '%'
                THEN 1.0::real
                ELSE similarity(p.busqueda_normalizada, v_norm)
           END AS sim
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id
      AND (p.busqueda_normalizada LIKE '%' || v_norm || '%'
           OR similarity(p.busqueda_normalizada, v_norm) >= p_umbral)
    ORDER BY sim DESC, p.nombre
    LIMIT 1000;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, real) TO authenticated;

-- ----------------------------------------------------------------------------
-- 25.2 buscar_clientes_ids — mismo fast-path (preventivo)
-- ----------------------------------------------------------------------------
-- La 024 computa normalizar_busqueda(razon_social) inline (no hay columna
-- materializada); se mantiene ese esquema. El índice clientes_busqueda_idx
-- (GIN por expresión, migración 024) acelera el LIKE.

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

  -- Fast-path substring (score 1.0) + trigram para typos.
  RETURN QUERY
    SELECT c.id AS cliente_id,
           CASE WHEN public.normalizar_busqueda(c.razon_social) LIKE '%' || v_norm || '%'
                THEN 1.0::real
                ELSE similarity(public.normalizar_busqueda(c.razon_social), v_norm)
           END AS score
    FROM public.clientes c
    WHERE c.empresa_id = v_empresa_id
      AND (public.normalizar_busqueda(c.razon_social) LIKE '%' || v_norm || '%'
           OR similarity(public.normalizar_busqueda(c.razon_social), v_norm) >= p_umbral)
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
  v_prod integer;
  v_cli integer;
  v_src text;
BEGIN
  SELECT count(*) INTO v_prod
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_productos_ids';

  SELECT count(*) INTO v_cli
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_clientes_ids';

  IF v_prod <> 1 THEN
    RAISE EXCEPTION 'buscar_productos_ids: se esperaba 1 función, hay %', v_prod;
  END IF;
  IF v_cli <> 1 THEN
    RAISE EXCEPTION 'buscar_clientes_ids: se esperaba 1 función, hay %', v_cli;
  END IF;

  -- Sanity: el cuerpo nuevo tiene el fast-path LIKE en la rama fuzzy.
  SELECT prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_productos_ids';
  IF v_src NOT LIKE '%CASE WHEN p.busqueda_normalizada LIKE%' THEN
    RAISE EXCEPTION 'buscar_productos_ids no tiene el fast-path substring';
  END IF;

  RAISE NOTICE 'OK: fast-path substring en buscar_productos_ids y buscar_clientes_ids.';
END;
$$;
