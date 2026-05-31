-- ============================================================================
-- 00000000000016_costo_en_bulk_import.sql
-- ----------------------------------------------------------------------------
-- Agrega manejo de 'costo' (opcional) a las 2 RPCs de import masivo:
--   * productos_bulk_import   (actualizar desde export, match por sku_variante)
--   * importar_productos_bulk (alta/actualización por plantilla, por sku_base)
--
-- Semántica del costo en import (igual en ambas):
--   * Si la fila trae 'costo' numérico → se valida >= 0 y se setea.
--   * Si está ausente / vacío / null → NO se toca el costo existente.
--   * No se puede borrar el costo vía import (por diseño).
--
-- Recrea ambas funciones idénticas a la 014 salvo el agregado de costo.
-- Patrón: CREATE OR REPLACE + REVOKE/GRANT + guard. NUNCA aplicar a prod
-- automáticamente — Tomás la corre.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16.1  productos_bulk_import (+ costo)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_import(
  p_usuario_id uuid,
  p_cambios jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_total integer;
  v_omitidos jsonb := '[]'::jsonb;
  v_advertencias jsonb := '[]'::jsonb;
  v_afectados integer := 0;
  v_ids_afectados jsonb := '[]'::jsonb;
  v_ids_afectados_array uuid[] := '{}';
  v_operacion_id uuid;
  v_item jsonb;
  v_sku text;
  -- destino resuelto
  v_var_id uuid;
  v_prod_id uuid;
  v_prod_nombre text;
  v_var_sku text;
  v_stock_ant integer;
  -- flags de presencia
  v_has_precio boolean;
  v_has_costo boolean;
  v_has_marca boolean;
  v_has_categoria boolean;
  v_has_activo boolean;
  v_has_stock boolean;
  v_has_activa boolean;
  v_has_codbar boolean;
  -- resolución marca/categoria
  v_marca_nombre text;
  v_cat_nombre text;
  v_marca_id uuid;
  v_categoria_id uuid;
  v_set_marca boolean;
  v_set_categoria boolean;
  v_cambio boolean;
  v_stock_nuevo integer;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede importar productos';
  END IF;

  -- ===== Empresa (re-derivada) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación del payload =====
  IF jsonb_typeof(p_cambios) <> 'array' THEN
    RAISE EXCEPTION 'p_cambios debe ser un array JSON';
  END IF;

  v_total := jsonb_array_length(p_cambios);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay cambios para aplicar';
  END IF;
  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 filas por operación (recibidas: %)', v_total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios)
      AS x(sku_variante text, precio_neto numeric, costo numeric, stock numeric)
    WHERE x.sku_variante IS NULL OR TRIM(x.sku_variante) = ''
       OR (x.precio_neto IS NOT NULL AND x.precio_neto <= 0)
       OR (x.costo IS NOT NULL AND x.costo < 0)
       OR (x.stock IS NOT NULL AND (x.stock < 0 OR x.stock <> trunc(x.stock)))
  ) THEN
    RAISE EXCEPTION 'Hay filas con sku_variante vacío, precio <= 0, costo < 0 o stock inválido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios) AS x(sku_variante text)
    GROUP BY x.sku_variante
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay sku_variante duplicados en el archivo';
  END IF;

  -- ===== Loop por fila =====
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cambios)
  LOOP
    v_sku := TRIM(v_item->>'sku_variante');

    SELECT v.id, v.producto_id, v.stock, v.sku_variante, p.nombre
    INTO v_var_id, v_prod_id, v_stock_ant, v_var_sku, v_prod_nombre
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.sku_variante = v_sku AND v.empresa_id = v_empresa_id
    LIMIT 1
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      v_omitidos := v_omitidos || jsonb_build_object('sku_variante', v_sku, 'motivo', 'SKU de variante no encontrado');
      CONTINUE;
    END IF;

    v_has_precio := (v_item ? 'precio_neto') AND jsonb_typeof(v_item->'precio_neto') = 'number';
    v_has_costo := (v_item ? 'costo') AND jsonb_typeof(v_item->'costo') = 'number';
    v_has_marca := (v_item ? 'marca');
    v_has_categoria := (v_item ? 'categoria');
    v_has_activo := (v_item ? 'activo') AND jsonb_typeof(v_item->'activo') = 'boolean';
    v_has_stock := (v_item ? 'stock') AND jsonb_typeof(v_item->'stock') = 'number';
    v_has_activa := (v_item ? 'activa') AND jsonb_typeof(v_item->'activa') = 'boolean';
    v_has_codbar := (v_item ? 'codigo_barras');

    -- ----- Resolver marca: crea la marca si no existe -----
    v_set_marca := false;
    IF v_has_marca THEN
      v_marca_nombre := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
      IF v_marca_nombre IS NULL THEN
        v_marca_id := NULL;          -- 'marca' presente y vacía => sin marca
        v_set_marca := true;
      ELSE
        INSERT INTO public.marcas (empresa_id, nombre, nombre_normalizado)
        VALUES (v_empresa_id, v_marca_nombre, public.normalizar_busqueda(v_marca_nombre))
        ON CONFLICT (empresa_id, nombre_normalizado)
          DO UPDATE SET nombre = marcas.nombre
        RETURNING id INTO v_marca_id;
        v_set_marca := true;
      END IF;
    END IF;

    -- ----- Resolver categoria: solo match, NO crea (curated) -----
    v_set_categoria := false;
    IF v_has_categoria THEN
      v_cat_nombre := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
      IF v_cat_nombre IS NULL THEN
        v_categoria_id := NULL;      -- 'categoria' presente y vacía => sin categoría
        v_set_categoria := true;
      ELSE
        SELECT id INTO v_categoria_id
        FROM public.catalogo_categorias
        WHERE empresa_id = v_empresa_id
          AND nombre_normalizado = public.normalizar_busqueda(v_cat_nombre);
        IF FOUND THEN
          v_set_categoria := true;
        ELSE
          v_advertencias := v_advertencias || jsonb_build_object(
            'sku_variante', v_sku,
            'motivo', 'Categoría "' || v_cat_nombre || '" no existe (se ignoró)'
          );
          v_set_categoria := false;
        END IF;
      END IF;
    END IF;

    v_cambio := false;

    -- ----- Product-level -----
    IF v_has_precio OR v_has_costo OR v_set_marca OR v_set_categoria OR v_has_activo THEN
      UPDATE public.productos p
      SET
        precio_neto = CASE WHEN v_has_precio
                           THEN round((v_item->>'precio_neto')::numeric, 2)
                           ELSE p.precio_neto END,
        costo       = CASE WHEN v_has_costo
                           THEN round((v_item->>'costo')::numeric, 2)
                           ELSE p.costo END,
        marca_id    = CASE WHEN v_set_marca THEN v_marca_id ELSE p.marca_id END,
        categoria_id = CASE WHEN v_set_categoria THEN v_categoria_id ELSE p.categoria_id END,
        activo      = CASE WHEN v_has_activo
                           THEN (v_item->>'activo')::boolean
                           ELSE p.activo END
      WHERE p.id = v_prod_id AND p.empresa_id = v_empresa_id;
      v_cambio := true;
    END IF;

    -- ----- Variant-level -----
    IF v_has_stock OR v_has_activa OR v_has_codbar THEN
      v_stock_nuevo := CASE WHEN v_has_stock
                            THEN (v_item->>'stock')::int
                            ELSE v_stock_ant END;

      UPDATE public.variantes v
      SET
        stock = v_stock_nuevo,
        activa = CASE WHEN v_has_activa
                      THEN (v_item->>'activa')::boolean
                      ELSE v.activa END,
        codigo_barras = CASE WHEN v_has_codbar
                             THEN NULLIF(v_item->>'codigo_barras', '')
                             ELSE v.codigo_barras END
      WHERE v.id = v_var_id AND v.empresa_id = v_empresa_id;
      v_cambio := true;

      IF v_has_stock AND v_stock_nuevo <> v_stock_ant THEN
        BEGIN
          INSERT INTO public.audit_log (
            usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle, empresa_id
          ) VALUES (
            p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
            'variantes', v_var_id::text, 'ajustar_stock',
            jsonb_build_object(
              'producto_nombre', v_prod_nombre,
              'variante_sku', v_var_sku,
              'stock_anterior', v_stock_ant,
              'delta', v_stock_nuevo - v_stock_ant,
              'stock_nuevo', v_stock_nuevo,
              'origen', 'import'
            ),
            v_empresa_id
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;

    IF v_cambio THEN
      v_afectados := v_afectados + 1;
      v_ids_afectados_array := array_append(v_ids_afectados_array, v_prod_id);
    END IF;
  END LOOP;

  v_ids_afectados := to_jsonb(v_ids_afectados_array);

  -- ===== Auditoría de la operación (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'import', jsonb_build_object('tipo', 'import'),
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'bulk_import',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'advertencias', v_advertencias,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 16.2  importar_productos_bulk (+ costo)
-- ----------------------------------------------------------------------------

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
  v_advertencias jsonb := '[]'::jsonb;
  v_skus_vistos text[] := ARRAY[]::text[];
  v_sku text;
  v_nombre text;
  v_marca text;
  v_cat_nombre text;
  v_marca_id uuid;
  v_categoria_id uuid;
  v_precio numeric;
  v_costo numeric;
  v_creados integer := 0;
  v_actualizados integer := 0;
  v_existe boolean;
  v_producto_id uuid;
BEGIN
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
    BEGIN
      v_precio := COALESCE((v_item->>'precio_neto')::numeric, -1);
    EXCEPTION WHEN OTHERS THEN
      v_precio := -1;
    END;
    -- costo opcional: no numérico => NULL (se trata como ausente).
    BEGIN
      v_costo := (v_item->>'costo')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_costo := NULL;
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
    IF v_marca IS NOT NULL AND length(v_marca) > 100 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Marca mayor a 100 caracteres');
      CONTINUE;
    END IF;
    IF v_precio < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Precio inválido o no numérico');
      CONTINUE;
    END IF;
    IF v_costo IS NOT NULL AND v_costo < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Costo negativo');
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
    v_cat_nombre := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    v_precio := (v_item->>'precio_neto')::numeric;
    -- costo opcional: NULL si ausente/no numérico (no se toca en UPDATE).
    BEGIN
      v_costo := (v_item->>'costo')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_costo := NULL;
    END;

    -- Resolver marca: se crea si no existe.
    v_marca_id := NULL;
    IF v_marca IS NOT NULL THEN
      INSERT INTO public.marcas (empresa_id, nombre, nombre_normalizado)
      VALUES (v_empresa_id, v_marca, public.normalizar_busqueda(v_marca))
      ON CONFLICT (empresa_id, nombre_normalizado)
        DO UPDATE SET nombre = marcas.nombre
      RETURNING id INTO v_marca_id;
    END IF;

    -- Resolver categoría: solo match, NO se crea (curated).
    v_categoria_id := NULL;
    IF v_cat_nombre IS NOT NULL THEN
      SELECT id INTO v_categoria_id
      FROM public.catalogo_categorias
      WHERE empresa_id = v_empresa_id
        AND nombre_normalizado = public.normalizar_busqueda(v_cat_nombre);
      IF NOT FOUND THEN
        v_advertencias := v_advertencias || jsonb_build_object(
          'sku', v_sku,
          'motivo', 'Categoría "' || v_cat_nombre || '" no existe (se ignoró)'
        );
      END IF;
    END IF;

    SELECT id INTO v_producto_id
    FROM public.productos
    WHERE sku_base = v_sku AND empresa_id = v_empresa_id
    LIMIT 1;

    v_existe := FOUND;

    IF v_existe THEN
      UPDATE public.productos
      SET nombre = v_nombre,
          marca_id = v_marca_id,
          categoria_id = v_categoria_id,
          precio_neto = v_precio,
          -- costo: si vino numérico se setea; si no, se preserva el actual.
          costo = COALESCE(v_costo, costo),
          updated_at = NOW()
      WHERE id = v_producto_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      INSERT INTO public.productos (
        sku_base, nombre, marca_id, categoria_id, precio_neto, costo,
        empresa_id, activo, track_stock
      ) VALUES (
        v_sku, v_nombre, v_marca_id, v_categoria_id, v_precio, v_costo,
        v_empresa_id, true, true
      )
      RETURNING id INTO v_producto_id;

      INSERT INTO public.variantes (
        producto_id, atributos, sku_variante, stock, activa, empresa_id
      ) VALUES (
        v_producto_id, '{}'::jsonb, v_sku || '-DEFAULT', 0, true, v_empresa_id
      );

      v_creados := v_creados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'creados', v_creados,
    'actualizados', v_actualizados,
    'advertencias', v_advertencias
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- Permisos (CREATE OR REPLACE preserva grants; se re-emiten por idempotencia)
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard
-- ----------------------------------------------------------------------------

DO $$
DECLARE v_funcs integer;
BEGIN
  SELECT count(*) INTO v_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('productos_bulk_import', 'importar_productos_bulk');
  IF v_funcs <> 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 RPCs de import, hay %.', v_funcs;
  END IF;
  RAISE NOTICE 'OK: productos_bulk_import + importar_productos_bulk con manejo de costo.';
END;
$$;
