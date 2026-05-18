-- ============================================================
-- MIGRATION: track_stock default true para todos los productos
-- Fecha: 2026-05-04
-- ============================================================
--
-- CONTEXTO:
-- Decisión de producto: todos los productos de Loom Point deben tener
-- tracking de stock activo. El toggle "Controlar stock" se elimina de
-- la UI por innecesario (tiene stock → vende → descuenta; no tiene → bloquea).
--
-- ESTA MIGRATION:
-- 1. UPDATE retroactivo: track_stock = true para todos los productos existentes
-- 2. ALTER DEFAULT: futuros productos arrancan con track_stock = true
-- 3. Actualizar importar_productos_bulk para crear con track_stock = true
--
-- IDEMPOTENTE: si ya está aplicada, los UPDATE no afectan filas y el ALTER
-- es un no-op si el default ya es true.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. UPDATE retroactivo — todos los productos con track_stock = true
-- ============================================================

UPDATE public.productos
SET track_stock = true
WHERE track_stock IS DISTINCT FROM true;

-- ============================================================
-- 2. ALTER DEFAULT — futuros productos arrancan con track_stock = true
-- ============================================================

ALTER TABLE public.productos
ALTER COLUMN track_stock SET DEFAULT true;

-- ============================================================
-- 3. Actualizar importar_productos_bulk
-- (cambia track_stock de false a true al crear productos importados)
-- ============================================================

CREATE OR REPLACE FUNCTION public.importar_productos_bulk(
  p_usuario_id uuid,
  p_productos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_total integer;
  v_errores jsonb := '[]'::jsonb;
  v_skus_vistos text[] := ARRAY[]::text[];
  v_sku text;
  v_nombre text;
  v_categoria text;
  v_precio numeric;
  v_creados integer := 0;
  v_actualizados integer := 0;
  v_existe boolean;
  v_producto_id uuid;
BEGIN
  -- Auth
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede importar productos';
  END IF;

  IF jsonb_typeof(p_productos) <> 'array' THEN
    RAISE EXCEPTION 'p_productos debe ser un array JSON';
  END IF;

  v_total := jsonb_array_length(p_productos);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay productos para importar';
  END IF;
  IF v_total > 5000 THEN
    RAISE EXCEPTION 'Máximo 5000 productos por importación';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ============ FASE 1: VALIDACIÓN COMPLETA ============
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_productos)
  LOOP
    v_idx := v_idx + 1;

    v_sku := NULLIF(TRIM(COALESCE(v_item->>'sku_base', '')), '');
    v_nombre := NULLIF(TRIM(COALESCE(v_item->>'nombre', '')), '');
    v_categoria := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    BEGIN
      v_precio := COALESCE((v_item->>'precio_neto')::numeric, -1);
    EXCEPTION WHEN OTHERS THEN
      v_precio := -1;
    END;

    IF v_sku IS NULL THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', '(vacío)', 'motivo', 'SKU vacío');
      CONTINUE;
    END IF;
    IF length(v_sku) > 50 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'SKU mayor a 50 caracteres');
      CONTINUE;
    END IF;
    IF v_sku = ANY(v_skus_vistos) THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'SKU duplicado en el archivo');
      CONTINUE;
    END IF;
    v_skus_vistos := array_append(v_skus_vistos, v_sku);
    IF v_nombre IS NULL THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Nombre vacío');
      CONTINUE;
    END IF;
    IF length(v_nombre) > 200 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Nombre mayor a 200 caracteres');
      CONTINUE;
    END IF;
    IF v_categoria IS NOT NULL AND length(v_categoria) > 100 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Categoría mayor a 100 caracteres');
      CONTINUE;
    END IF;
    IF v_precio < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Precio inválido o no numérico');
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errores) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'total_filas', v_total,
      'validados', 0,
      'errores', v_errores,
      'cantidad_errores', jsonb_array_length(v_errores)
    );
  END IF;

  -- ============ FASE 2: INSERT/UPDATE atómico ============
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_productos)
  LOOP
    v_sku := TRIM(v_item->>'sku_base');
    v_nombre := TRIM(v_item->>'nombre');
    v_categoria := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    v_precio := (v_item->>'precio_neto')::numeric;

    SELECT id INTO v_producto_id
    FROM public.productos
    WHERE sku_base = v_sku AND empresa_id = v_empresa_id
    LIMIT 1;

    v_existe := FOUND;

    IF v_existe THEN
      -- ACTUALIZAR (no toca variantes ni stock ni track_stock)
      UPDATE public.productos
      SET
        nombre = v_nombre,
        categoria = v_categoria,
        precio_neto = v_precio,
        updated_at = NOW()
      WHERE id = v_producto_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      -- CREAR producto nuevo con track_stock = true (DEFAULT, lo dejamos
      -- explícito para legibilidad)
      INSERT INTO public.productos (
        sku_base, nombre, categoria, precio_neto,
        empresa_id, activo, track_stock
      ) VALUES (
        v_sku, v_nombre, v_categoria, v_precio,
        v_empresa_id, true, true
      )
      RETURNING id INTO v_producto_id;

      -- Crear variante "default" automáticamente: sin color ni talle, stock 0
      INSERT INTO public.variantes (
        producto_id, color, talle, sku_variante, stock, activa, empresa_id
      ) VALUES (
        v_producto_id, NULL, NULL, v_sku || '-DEFAULT', 0, true, v_empresa_id
      );

      v_creados := v_creados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'creados', v_creados,
    'actualizados', v_actualizados
  );
END;
$function$;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================

-- Cuántos productos quedaron con track_stock = true (debe ser TODOS los activos)
SELECT
  count(*) FILTER (WHERE track_stock = true) AS con_tracking,
  count(*) FILTER (WHERE track_stock = false) AS sin_tracking
FROM public.productos
WHERE activo = true;

-- Esperado: sin_tracking = 0
