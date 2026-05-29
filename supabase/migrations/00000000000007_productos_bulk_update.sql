-- ============================================================================
-- 00000000000007_productos_bulk_update.sql
-- ----------------------------------------------------------------------------
-- Acciones masivas sobre el catálogo de productos (Fase 1).
--
-- Dos RPCs atómicas plpgsql que ejecutan los bulks desde el listado de admin:
--
--   1. productos_bulk_update(p_usuario_id, p_accion, p_ids, p_params)
--        Acciones a nivel PRODUCTO (un solo UPDATE set-based):
--          - precio_pct        : subir/bajar precio_neto un porcentaje
--          - precio_fijo       : establecer precio_neto fijo
--          - cambiar_categoria : setear categoria (vacío => NULL = sin categoría)
--          - cambiar_activo    : activar/desactivar
--
--   2. productos_bulk_stock(p_usuario_id, p_modo, p_valor, p_motivo, p_ids)
--        Ajuste de stock a nivel VARIANTE (loop con FOR UPDATE + audit_log):
--          - sumar  : stock = stock + valor
--          - restar : stock = stock - valor
--          - fijar  : stock = valor (absoluto)
--
-- DECISIONES (relevamiento aprobado):
--   * Cap de lote: 1000 ids por operación (RAISE si se supera).
--   * Stock multi-variante: se SKIPEAN los productos con >1 variante activa
--     (y los sin variantes / sin track_stock / que quedarían negativos) y se
--     devuelven en `omitidos`. NO se distribuye ni multiplica el ajuste.
--   * Motivo de stock bulk: OBLIGATORIO (>=3 chars), uno para todo el lote,
--     replicado en cada fila de audit_log (accion='ajustar_stock', origen=bulk).
--   * Categoría: NO se valida existencia (el frontend solo ofrece existentes).
--     Categoría vacía/ausente => NULL (sin categoría).
--   * Precio por PRODUCTO (productos.precio_neto). variantes.precio_neto_override
--     está dormido en el código de la app y NO se toca acá.
--   * Atomicidad: total. Cualquier error => RAISE => rollback automático.
--   * `omitidos` son ids inválidos/no aplicables (soft), NO fallas de mutación:
--     no rompen la transacción, igual que asignar_cliente_bulk.
--
-- Patrón copiado de importar_productos_bulk (migration 3) para el scaffolding
-- (auth + re-derivar empresa_id de usuarios) y de ajustar_stock (migration 3)
-- para el FOR UPDATE + escritura en audit_log.
--
-- Permiso: solo admin/superadmin (public.es_admin()), igual que el resto del
-- ABM de catálogo. El hardening de empresa_id en las actions singulares
-- (actualizar-precio.ts, etc.) queda pendiente para otro paso.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7.1 productos_bulk_update — acciones a nivel producto
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_update(
  p_usuario_id uuid,
  p_accion text,
  p_ids uuid[],
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_ids uuid[];
  v_total integer;
  v_validos uuid[];
  v_omitidos jsonb;
  v_afectados integer := 0;
  -- params tipados
  v_pct numeric;
  v_precio numeric;
  v_categoria text;
  v_activo boolean;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede modificar productos en masa';
  END IF;

  -- ===== Empresa (re-derivada, no se confía en el cliente) =====
  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación de ids (dedup + cap) =====
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay productos para modificar';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_ids));
  v_total := array_length(v_ids, 1);

  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 productos por operación (recibidos: %)', v_total;
  END IF;

  -- ===== Validación de acción + params (batch-level => RAISE) =====
  IF p_accion = 'precio_pct' THEN
    -- IS DISTINCT FROM: si la clave está ausente jsonb_typeof devuelve NULL y
    -- un <> 'number' no dispararía el RAISE (NULL en IF = false).
    IF jsonb_typeof(p_params->'pct') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'precio_pct requiere params.pct numérico';
    END IF;
    v_pct := (p_params->>'pct')::numeric;
    IF v_pct < -100 THEN
      RAISE EXCEPTION 'El porcentaje no puede ser menor a -100 (descuento máximo 100%%)';
    END IF;

  ELSIF p_accion = 'precio_fijo' THEN
    IF jsonb_typeof(p_params->'precio') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'precio_fijo requiere params.precio numérico';
    END IF;
    v_precio := (p_params->>'precio')::numeric;
    IF v_precio <= 0 THEN
      RAISE EXCEPTION 'El precio fijo debe ser mayor a 0';
    END IF;

  ELSIF p_accion = 'cambiar_categoria' THEN
    -- Vacío/ausente => NULL (sin categoría). No se valida existencia.
    v_categoria := NULLIF(TRIM(COALESCE(p_params->>'categoria', '')), '');
    IF v_categoria IS NOT NULL AND length(v_categoria) > 100 THEN
      RAISE EXCEPTION 'La categoría no puede superar 100 caracteres';
    END IF;

  ELSIF p_accion = 'cambiar_activo' THEN
    IF jsonb_typeof(p_params->'activo') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'cambiar_activo requiere params.activo booleano';
    END IF;
    v_activo := (p_params->>'activo')::boolean;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion;
  END IF;

  -- ===== Fase 1: validación de pertenencia =====
  -- Solo ids que existen y pertenecen a la empresa del usuario.
  SELECT array_agg(id) INTO v_validos
  FROM public.productos
  WHERE id = ANY(v_ids) AND empresa_id = v_empresa_id;

  v_validos := COALESCE(v_validos, ARRAY[]::uuid[]);

  -- Omitidos = ids solicitados que no matchean (no existe / otra empresa).
  -- No se filtra existencia en el mensaje (mismo motivo genérico).
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', x, 'motivo', 'No encontrado')),
           '[]'::jsonb
         )
  INTO v_omitidos
  FROM unnest(v_ids) AS x
  WHERE NOT (x = ANY(v_validos));

  -- ===== Fase 2: mutación atómica (set-based) =====
  -- updated_at lo maneja el trigger productos_set_updated_at.
  IF array_length(v_validos, 1) IS NOT NULL THEN
    IF p_accion = 'precio_pct' THEN
      UPDATE public.productos
      SET precio_neto = GREATEST(round(precio_neto * (1 + v_pct / 100.0), 2), 0)
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'precio_fijo' THEN
      UPDATE public.productos
      SET precio_neto = round(v_precio, 2)
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'cambiar_categoria' THEN
      UPDATE public.productos
      SET categoria = v_categoria
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'cambiar_activo' THEN
      UPDATE public.productos
      SET activo = v_activo
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;
    END IF;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', p_accion,
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7.2 productos_bulk_stock — ajuste de stock a nivel variante
-- Loop por producto (FOR UPDATE) para poder clasificar omitidos y auditar.
-- Solo productos con EXACTAMENTE 1 variante activa se tocan; el resto se omite.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_stock(
  p_usuario_id uuid,
  p_modo text,
  p_valor integer,
  p_motivo text,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_ids uuid[];
  v_total integer;
  v_omitidos jsonb := '[]'::jsonb;
  v_afectados integer := 0;
  v_motivo text;
  -- por producto
  v_pid uuid;
  v_track boolean;
  v_count integer;
  v_var_id uuid;
  v_var_sku text;
  v_prod_nombre text;
  v_stock_ant integer;
  v_stock_new integer;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede ajustar stock en masa';
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

  -- ===== Validación de modo / valor / motivo (batch-level => RAISE) =====
  IF p_modo NOT IN ('sumar', 'restar', 'fijar') THEN
    RAISE EXCEPTION 'Modo inválido: % (esperado sumar | restar | fijar)', p_modo;
  END IF;
  IF p_valor IS NULL THEN
    RAISE EXCEPTION 'El valor de ajuste es obligatorio';
  END IF;
  IF p_modo IN ('sumar', 'restar') AND p_valor <= 0 THEN
    RAISE EXCEPTION 'El valor para sumar/restar debe ser mayor a 0';
  END IF;
  IF p_modo = 'fijar' AND p_valor < 0 THEN
    RAISE EXCEPTION 'El valor para fijar no puede ser negativo';
  END IF;

  v_motivo := NULLIF(TRIM(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mín. 3 caracteres)';
  END IF;

  -- ===== Validación de ids (dedup + cap) =====
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay productos para ajustar';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_ids));
  v_total := array_length(v_ids, 1);

  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 productos por operación (recibidos: %)', v_total;
  END IF;

  -- ===== Loop por producto: clasificar y mutar =====
  FOREACH v_pid IN ARRAY v_ids
  LOOP
    -- Existe y pertenece a la empresa
    SELECT track_stock, nombre INTO v_track, v_prod_nombre
    FROM public.productos
    WHERE id = v_pid AND empresa_id = v_empresa_id;

    IF NOT FOUND THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_pid, 'motivo', 'No encontrado');
      CONTINUE;
    END IF;

    IF NOT v_track THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_pid, 'motivo', 'Producto sin control de stock');
      CONTINUE;
    END IF;

    -- Cantidad de variantes activas
    SELECT count(*) INTO v_count
    FROM public.variantes
    WHERE producto_id = v_pid AND activa AND empresa_id = v_empresa_id;

    IF v_count = 0 THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_pid, 'motivo', 'Sin variantes activas');
      CONTINUE;
    END IF;
    IF v_count > 1 THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_pid, 'motivo', 'Múltiples variantes — ajustá desde el detalle');
      CONTINUE;
    END IF;

    -- Única variante activa: lock + lectura (race-safe, igual que ajustar_stock)
    SELECT id, stock, sku_variante INTO v_var_id, v_stock_ant, v_var_sku
    FROM public.variantes
    WHERE producto_id = v_pid AND activa AND empresa_id = v_empresa_id
    FOR UPDATE;

    -- Calcular stock nuevo
    IF p_modo = 'sumar' THEN
      v_stock_new := v_stock_ant + p_valor;
    ELSIF p_modo = 'restar' THEN
      v_stock_new := v_stock_ant - p_valor;
    ELSE -- fijar
      v_stock_new := p_valor;
    END IF;

    IF v_stock_new < 0 THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_pid, 'motivo', 'Stock insuficiente (quedaría negativo)');
      CONTINUE;
    END IF;

    -- Mutar
    UPDATE public.variantes
    SET stock = v_stock_new
    WHERE id = v_var_id AND empresa_id = v_empresa_id;

    -- Auditar (un registro por variante; el audit no debe tumbar la operación)
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
          'delta', v_stock_new - v_stock_ant,
          'stock_nuevo', v_stock_new,
          'motivo', v_motivo,
          'origen', 'bulk',
          'modo', p_modo
        ),
        v_empresa_id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    v_afectados := v_afectados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- Permisos: solo invocables por usuarios autenticados (no anon/public).
-- El check de admin/empresa es interno (defense in depth).
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_stock(uuid, text, integer, text, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_stock(uuid, text, integer, text, uuid[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard: confirmar que ambas funciones existen y sin overloads duplicados.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_update_count integer;
  v_stock_count integer;
BEGIN
  SELECT count(*) INTO v_update_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'productos_bulk_update';

  SELECT count(*) INTO v_stock_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'productos_bulk_stock';

  IF v_update_count <> 1 THEN
    RAISE EXCEPTION 'productos_bulk_update: se esperaba 1 función, hay %', v_update_count;
  END IF;
  IF v_stock_count <> 1 THEN
    RAISE EXCEPTION 'productos_bulk_stock: se esperaba 1 función, hay %', v_stock_count;
  END IF;

  RAISE NOTICE 'OK: productos_bulk_update y productos_bulk_stock creadas (1 c/u, sin overloads).';
END;
$$;
