-- ============================================================================
-- 00000000000008_productos_bulk_individual.sql
-- ----------------------------------------------------------------------------
-- Fase 2 de acciones masivas: aplicar valores INDIVIDUALES por producto
-- (preview editable fila por fila). A diferencia de la Fase 1
-- (productos_bulk_update / productos_bulk_stock, que aplican UNA regla a N ids),
-- acá cada producto trae su valor final concreto.
--
-- Dos RPCs:
--
--   1. productos_bulk_precio_individual(p_usuario_id, p_cambios)
--        p_cambios: [{ id uuid, precio numeric }]  → precio final por producto.
--        UPDATE set-based con jsonb_to_recordset.
--
--   2. productos_bulk_stock_individual(p_usuario_id, p_motivo, p_cambios)
--        p_cambios: [{ id uuid, stock integer }]   → stock ABSOLUTO final de la
--        única variante activa. Loop con FOR UPDATE + audit_log por variante.
--
-- DECISIONES (relevamiento Fase 2 aprobado):
--   * Cap 1000 cambios por operación (RAISE si se supera).
--   * Atómica: cualquier error => RAISE => rollback total.
--   * Stock: solo productos con EXACTAMENTE 1 variante activa; el resto
--     (sin track_stock / 0 variantes / >1 variante) se devuelve en `omitidos`.
--     El stock es absoluto y se valida >= 0, así que no hay caso "negativo".
--   * Stock con delta 0 (nuevo == anterior): se skipea sin UPDATE ni audit
--     (no cuenta como afectado; no es omitido, es no-op).
--   * Motivo de stock: OBLIGATORIO (>=3), uno solo para todo el lote, replicado
--     en cada fila de audit_log con accion='ajustar_stock', origen='bulk_individual'.
--   * Precio por PRODUCTO (productos.precio_neto). round(precio, 2) en la RPC.
--
-- Patrón copiado de productos_bulk_update / productos_bulk_stock (migración 007)
-- y ajustar_stock (migración 003).
--
-- Permiso: solo admin/superadmin (public.es_admin()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 8.1 productos_bulk_precio_individual — precio final por producto
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
  v_total integer;
  v_omitidos jsonb;
  v_afectados integer := 0;
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
  SELECT empresa_id INTO v_empresa_id
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

  -- Cada precio debe ser numérico > 0.
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

  -- ===== Fase 2: UPDATE set-based (updated_at por trigger) =====
  UPDATE public.productos p
  SET precio_neto = round(c.precio, 2)
  FROM jsonb_to_recordset(p_cambios) AS c(id uuid, precio numeric)
  WHERE p.id = c.id AND p.empresa_id = v_empresa_id;

  GET DIAGNOSTICS v_afectados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'precio_individual',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8.2 productos_bulk_stock_individual — stock absoluto final por producto
-- Loop por producto (FOR UPDATE) para clasificar omitidos y auditar.
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

  -- Cada stock debe ser entero >= 0.
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

    -- Única variante activa: lock + lectura (race-safe).
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
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'stock_individual',
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

REVOKE EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_stock_individual(uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_stock_individual(uuid, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard: confirmar que ambas funciones existen y sin overloads duplicados.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_precio_count integer;
  v_stock_count integer;
BEGIN
  SELECT count(*) INTO v_precio_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'productos_bulk_precio_individual';

  SELECT count(*) INTO v_stock_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'productos_bulk_stock_individual';

  IF v_precio_count <> 1 THEN
    RAISE EXCEPTION 'productos_bulk_precio_individual: se esperaba 1 función, hay %', v_precio_count;
  END IF;
  IF v_stock_count <> 1 THEN
    RAISE EXCEPTION 'productos_bulk_stock_individual: se esperaba 1 función, hay %', v_stock_count;
  END IF;

  RAISE NOTICE 'OK: productos_bulk_precio_individual y productos_bulk_stock_individual creadas (1 c/u, sin overloads).';
END;
$$;
