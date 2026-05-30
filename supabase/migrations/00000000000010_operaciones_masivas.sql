-- ============================================================================
-- 00000000000010_operaciones_masivas.sql
-- ----------------------------------------------------------------------------
-- Fase 4: auditoría de operaciones masivas.
--
-- 1) Tabla operaciones_masivas: una fila por operación masiva (Fases 1/2/3).
--    Registra la operación (no campo por campo): a qué afectó, qué omitió.
-- 2) Reescribe las 5 RPCs existentes para que, justo antes del RETURN, inserten
--    UNA fila en operaciones_masivas y devuelvan operacion_id en el jsonb.
--    Las firmas (input/output salvo el campo nuevo) NO cambian → backward-compatible.
--
-- DECISIONES:
--   * RLS por EMPRESA (todos los admin de la empresa ven todas las operaciones).
--     El gate admin-only se hace a nivel página (redirect vendedor).
--   * accion: text (no enum) para flexibilidad.
--   * ids_afectados / omitidos: jsonb NOT NULL DEFAULT '[]'.
--   * parametros: descriptor chico (NO el p_cambios completo).
--   * El INSERT de auditoría es ATÓMICO (sin EXCEPTION WHEN OTHERS): si falla,
--     falla toda la operación. Una op masiva sin registro es peor que reintentar.
--     (A diferencia del audit_log de stock, que sí es tolerante.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10.1 Tabla
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.operaciones_masivas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  usuario_email_snapshot text NOT NULL,
  accion text NOT NULL,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_solicitados integer NOT NULL DEFAULT 0,
  afectados integer NOT NULL DEFAULT 0,
  cantidad_omitidos integer NOT NULL DEFAULT 0,
  omitidos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ids_afectados jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operaciones_masivas_empresa_creado_idx
  ON public.operaciones_masivas(empresa_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS operaciones_masivas_accion_idx
  ON public.operaciones_masivas(empresa_id, accion);

ALTER TABLE public.operaciones_masivas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operaciones_masivas_select ON public.operaciones_masivas;
CREATE POLICY operaciones_masivas_select ON public.operaciones_masivas FOR SELECT
  USING (es_superadmin() OR empresa_id = get_empresa_id());

-- Sin policy de INSERT/UPDATE/DELETE: solo las RPCs SECURITY DEFINER escriben.

-- ----------------------------------------------------------------------------
-- 10.2 productos_bulk_update (Fase 1, precio/categoría/activo) + auditoría
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
  v_usuario_email text;
  v_ids uuid[];
  v_total integer;
  v_validos uuid[];
  v_omitidos jsonb;
  v_afectados integer := 0;
  v_ids_afectados jsonb := '[]'::jsonb;
  v_operacion_id uuid;
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
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
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
  SELECT array_agg(id) INTO v_validos
  FROM public.productos
  WHERE id = ANY(v_ids) AND empresa_id = v_empresa_id;

  v_validos := COALESCE(v_validos, ARRAY[]::uuid[]);

  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', x, 'motivo', 'No encontrado')),
           '[]'::jsonb
         )
  INTO v_omitidos
  FROM unnest(v_ids) AS x
  WHERE NOT (x = ANY(v_validos));

  -- ===== Fase 2: mutación atómica (set-based) =====
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

  v_ids_afectados := to_jsonb(v_validos);

  -- ===== Auditoría (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    p_accion, p_params,
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', p_accion,
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10.3 productos_bulk_stock (Fase 1, stock por regla) + auditoría
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
  v_ids_afectados jsonb := '[]'::jsonb;
  v_ids_afectados_array uuid[] := '{}';
  v_operacion_id uuid;
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

    SELECT id, stock, sku_variante INTO v_var_id, v_stock_ant, v_var_sku
    FROM public.variantes
    WHERE producto_id = v_pid AND activa AND empresa_id = v_empresa_id
    FOR UPDATE;

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

    UPDATE public.variantes
    SET stock = v_stock_new
    WHERE id = v_var_id AND empresa_id = v_empresa_id;

    -- Auditoría granular por variante (tolerante: no debe tumbar la operación).
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
    v_ids_afectados_array := array_append(v_ids_afectados_array, v_pid);
  END LOOP;

  v_ids_afectados := to_jsonb(v_ids_afectados_array);

  -- ===== Auditoría de la operación (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'stock_' || p_modo,
    jsonb_build_object('modo', p_modo, 'valor', p_valor, 'motivo', v_motivo),
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10.4 productos_bulk_precio_individual (Fase 2) + auditoría
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_precio_individual(
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
  v_omitidos jsonb;
  v_afectados integer := 0;
  v_ids_afectados jsonb := '[]'::jsonb;
  v_operacion_id uuid;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede modificar precios en masa';
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
    RAISE EXCEPTION 'Máximo 1000 productos por operación (recibidos: %)', v_total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios) AS x(id uuid, precio numeric)
    WHERE x.id IS NULL OR x.precio IS NULL OR x.precio <= 0
  ) THEN
    RAISE EXCEPTION 'Cada cambio requiere id válido y precio mayor a 0';
  END IF;

  -- ===== Fase 1: omitidos (ids que no existen / otra empresa) =====
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', c.id, 'motivo', 'No encontrado')),
           '[]'::jsonb
         )
  INTO v_omitidos
  FROM jsonb_to_recordset(p_cambios) AS c(id uuid, precio numeric)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.productos p
    WHERE p.id = c.id AND p.empresa_id = v_empresa_id
  );

  -- ===== Fase 2: UPDATE set-based con RETURNING para capturar ids afectados =====
  WITH upd AS (
    UPDATE public.productos p
    SET precio_neto = round(c.precio, 2)
    FROM jsonb_to_recordset(p_cambios) AS c(id uuid, precio numeric)
    WHERE p.id = c.id AND p.empresa_id = v_empresa_id
    RETURNING p.id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb), count(*)
  INTO v_ids_afectados, v_afectados
  FROM upd;

  -- ===== Auditoría (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'precio_individual', jsonb_build_object('tipo', 'individual'),
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'precio_individual',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10.5 productos_bulk_stock_individual (Fase 2) + auditoría
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_stock_individual(
  p_usuario_id uuid,
  p_motivo text,
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
  v_ids_afectados jsonb := '[]'::jsonb;
  v_ids_afectados_array uuid[] := '{}';
  v_operacion_id uuid;
  v_motivo text;
  v_item jsonb;
  -- por producto
  v_pid uuid;
  v_stock_nuevo integer;
  v_track boolean;
  v_count integer;
  v_var_id uuid;
  v_var_sku text;
  v_prod_nombre text;
  v_stock_ant integer;
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

  -- ===== Validación del payload =====
  v_motivo := NULLIF(TRIM(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mín. 3 caracteres)';
  END IF;

  IF jsonb_typeof(p_cambios) <> 'array' THEN
    RAISE EXCEPTION 'p_cambios debe ser un array JSON';
  END IF;

  v_total := jsonb_array_length(p_cambios);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay cambios para aplicar';
  END IF;
  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 productos por operación (recibidos: %)', v_total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios) AS x(id uuid, stock numeric)
    WHERE x.id IS NULL OR x.stock IS NULL OR x.stock < 0 OR x.stock <> trunc(x.stock)
  ) THEN
    RAISE EXCEPTION 'Cada cambio requiere id válido y stock entero >= 0';
  END IF;

  -- ===== Loop por producto =====
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cambios)
  LOOP
    v_pid := (v_item->>'id')::uuid;
    v_stock_nuevo := (v_item->>'stock')::int;

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

    SELECT id, stock, sku_variante INTO v_var_id, v_stock_ant, v_var_sku
    FROM public.variantes
    WHERE producto_id = v_pid AND activa AND empresa_id = v_empresa_id
    FOR UPDATE;

    -- No-op: el stock no cambia → no se toca ni se audita.
    IF v_stock_nuevo = v_stock_ant THEN
      CONTINUE;
    END IF;

    UPDATE public.variantes
    SET stock = v_stock_nuevo
    WHERE id = v_var_id AND empresa_id = v_empresa_id;

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
          'motivo', v_motivo,
          'origen', 'bulk_individual'
        ),
        v_empresa_id
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    v_afectados := v_afectados + 1;
    v_ids_afectados_array := array_append(v_ids_afectados_array, v_pid);
  END LOOP;

  v_ids_afectados := to_jsonb(v_ids_afectados_array);

  -- ===== Auditoría de la operación (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'stock_individual',
    jsonb_build_object('tipo', 'individual', 'motivo', v_motivo),
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'stock_individual',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10.6 productos_bulk_import (Fase 3) + auditoría
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
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- Permisos (CREATE OR REPLACE preserva los grants previos; se re-emiten por
-- idempotencia / claridad).
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_stock(uuid, text, integer, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_stock_individual(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_stock(uuid, text, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_stock_individual(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_tabla integer;
  v_funcs integer;
BEGIN
  SELECT count(*) INTO v_tabla
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'operaciones_masivas';

  SELECT count(*) INTO v_funcs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'productos_bulk_update',
      'productos_bulk_stock',
      'productos_bulk_precio_individual',
      'productos_bulk_stock_individual',
      'productos_bulk_import'
    );

  IF v_tabla <> 1 THEN
    RAISE EXCEPTION 'operaciones_masivas: se esperaba la tabla, hay %', v_tabla;
  END IF;
  IF v_funcs <> 5 THEN
    RAISE EXCEPTION 'Se esperaban 5 RPCs de bulk, hay %', v_funcs;
  END IF;

  RAISE NOTICE 'OK: tabla operaciones_masivas + 5 RPCs reescritas con auditoría.';
END;
$$;
