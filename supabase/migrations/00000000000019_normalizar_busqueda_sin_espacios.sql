-- ============================================================================
-- 00000000000019_normalizar_busqueda_sin_espacios.sql
-- ----------------------------------------------------------------------------
-- Bug: 'abro ch a do ra' no matchea 'ABROCHADORA KANGARO' en fuzzy search.
-- Causa: normalizar_busqueda colapsa espacios múltiples pero los preserva.
-- Los trigramas con espacios no aparecen en la version continua del producto.
--
-- Fix: eliminar todos los whitespaces en normalizar_busqueda.
-- Resultado: 'abro ch a do ra' → 'abrochadora', matchea 'abrochadorakangaro...'.
--
-- Casos cubiertos:
--   * Tipeo con espacios accidentales (scanner-like).
--   * Multiples espacios entre palabras (siguen colapsando, ahora total).
--   * Tabs y otros whitespaces.
--
-- NOTA: se mantiene public.immutable_unaccent (wrapper IMMUTABLE de unaccent,
-- que es STABLE) — patrón canónico ya usado en la migración 011 para que esta
-- función siga siendo verdaderamente IMMUTABLE. Único cambio respecto de la 011:
-- el reemplazo de espacios pasa de ' ' (colapsar) a '' (eliminar).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalizar_busqueda(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT regexp_replace(
    lower(public.immutable_unaccent(coalesce(t, ''))),
    '\s+', '', 'g'
  );
$function$;

-- Backfill: recalcular busqueda_normalizada de TODOS los productos.
-- El trigger productos_busqueda_normalizada_trigger se dispara en UPDATE OF
-- nombre/sku_base/marca_id/categoria_id, NO en update de busqueda_normalizada
-- directamente, así que el set-based explicito es lo que toca.
UPDATE public.productos p
SET busqueda_normalizada = public.normalizar_busqueda(
  p.nombre || ' ' ||
  COALESCE(p.sku_base, '') || ' ' ||
  COALESCE((SELECT nombre FROM public.marcas WHERE id = p.marca_id), '') || ' ' ||
  COALESCE((SELECT nombre FROM public.catalogo_categorias WHERE id = p.categoria_id), '')
);

-- Guard
DO $$
DECLARE v text;
BEGIN
  SELECT public.normalizar_busqueda('Hola Mundo') INTO v;
  IF v <> 'holamundo' THEN
    RAISE EXCEPTION 'normalizar_busqueda no eliminó espacios. Got: %', v;
  END IF;
  SELECT public.normalizar_busqueda('abro ch a do ra') INTO v;
  IF v <> 'abrochadora' THEN
    RAISE EXCEPTION 'Test caso real falló. Got: %', v;
  END IF;
  RAISE NOTICE 'OK: normalizar_busqueda elimina espacios. Backfill aplicado.';
END;
$$;
