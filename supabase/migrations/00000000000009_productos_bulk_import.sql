-- ============================================================================
-- 00000000000009_productos_bulk_import.sql
-- ----------------------------------------------------------------------------
-- Fase 3: actualización masiva de productos desde un Excel exportado
-- (módulo importar/, pestaña "Actualizar desde export").
--
-- RPC: productos_bulk_import(p_usuario_id, p_cambios)
--   p_cambios: array de { sku_variante, precio_neto?, categoria?, activo?,
--                         stock?, activa?, codigo_barras? }
--   Cada fila matchea una VARIANTE por sku_variante (+ empresa). Solo se
--   actualizan los campos PRESENTES en el objeto:
--     - product-level: precio_neto, categoria, activo  (tabla productos)
--     - variant-level: stock, activa, codigo_barras     (tabla variantes)
--
-- DECISIONES:
--   * Solo UPDATE: si el sku_variante no existe → fila omitida ('SKU de variante
--     no encontrado'). NO se crea nada.
--   * "Campo ausente" (no tocar) vs "campo presente = null" (pisar): se distingue
--     con el operador `?` de jsonb por fila. Por eso es loop, no set-based
--     (jsonb_to_recordset colapsa ausente y null a SQL NULL).
--   * categoria presente como null o '' → NULL ("sin categoría").
--   * codigo_barras presente como null → NULL.
--   * Conflictos product-level entre filas del mismo producto: NO se validan acá,
--     los resuelve el cliente en el preview (omite el producto antes de enviar).
--   * Cap 1000. Atómica: cualquier error => RAISE => rollback.
--   * Cambio de stock se audita: accion='ajustar_stock', origen='import'.
--
-- Patrón copiado de productos_bulk_stock_individual (migración 008) y
-- ajustar_stock (migración 003). Permiso: solo admin/superadmin.
-- ============================================================================

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
  v_afectados integer := 0;
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
  v_has_categoria boolean;
  v_has_activo boolean;
  v_has_stock boolean;
  v_has_activa boolean;
  v_has_codbar boolean;
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

  -- sku_variante obligatorio; precio (si presente y numérico) > 0; stock (si
  -- presente y numérico) entero >= 0.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios)
      AS x(sku_variante text, precio_neto numeric, stock numeric)
    WHERE x.sku_variante IS NULL OR TRIM(x.sku_variante) = ''
       OR (x.precio_neto IS NOT NULL AND x.precio_neto <= 0)
       OR (x.stock IS NOT NULL AND (x.stock < 0 OR x.stock <> trunc(x.stock)))
  ) THEN
    RAISE EXCEPTION 'Hay filas con sku_variante vacío, precio <= 0 o stock inválido';
  END IF;

  -- Duplicados de sku_variante en el archivo.
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
    v_has_categoria := (v_item ? 'categoria');
    v_has_activo := (v_item ? 'activo') AND jsonb_typeof(v_item->'activo') = 'boolean';
    v_has_stock := (v_item ? 'stock') AND jsonb_typeof(v_item->'stock') = 'number';
    v_has_activa := (v_item ? 'activa') AND jsonb_typeof(v_item->'activa') = 'boolean';
    v_has_codbar := (v_item ? 'codigo_barras');

    v_cambio := false;

    -- ----- Product-level -----
    IF v_has_precio OR v_has_categoria OR v_has_activo THEN
      UPDATE public.productos p
      SET
        precio_neto = CASE WHEN v_has_precio
                           THEN round((v_item->>'precio_neto')::numeric, 2)
                           ELSE p.precio_neto END,
        categoria   = CASE WHEN v_has_categoria
                           THEN NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '')
                           ELSE p.categoria END,
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

      -- Auditar el cambio de stock si efectivamente cambió.
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
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'bulk_import',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- Permisos
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'productos_bulk_import';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'productos_bulk_import: se esperaba 1 función, hay %', v_count;
  END IF;

  RAISE NOTICE 'OK: productos_bulk_import creada (1 función, sin overloads).';
END;
$$;
