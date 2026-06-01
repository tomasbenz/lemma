-- ============================================================================
-- Migración 023 — Detalle de precios + reversibilidad (Fase B)
-- ============================================================================
--
-- Fase B del audit de aumentos. Agrega:
--   1) Tabla `operaciones_masivas_precio_detalle`: snapshot por producto de
--      (precio_anterior, precio_nuevo, nombre, sku) de cada operación que mueve
--      precio. Inmutable (RLS select-only + trigger anti UPDATE/DELETE).
--   2) `productos_bulk_precio_individual` ahora ESCRIBE el detalle dentro de la
--      misma transacción (cubre precio_individual y aumento_workspace).
--   3) RPC `revertir_operacion_precios`: restaura bit-exact el precio_anterior
--      desde el detalle, con 4 condiciones (24h, no revertida, es la última
--      operación de precios, ningún producto tocado después). La reversión es
--      una operación NUEVA (accion='reversion_precios') que también deja detalle.
--
-- NOTA: precio_pct / precio_fijo de la pantalla principal usan productos_bulk_update
-- (NO esta RPC) y por ahora NO escriben detalle → no son revertibles en Fase B.
-- Sí cuentan como "operación de precios" para la condición de "última operación".
--
-- IMPORTANTE: NO aplicar a prod automáticamente. Tomás la aplica a mano.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla de detalle
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operaciones_masivas_precio_detalle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES public.operaciones_masivas(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  producto_nombre_snapshot text NOT NULL,
  producto_sku_snapshot text,
  precio_anterior numeric(14,2) NOT NULL,
  precio_nuevo numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_precio_detalle_operacion
  ON public.operaciones_masivas_precio_detalle(operacion_id);
CREATE INDEX IF NOT EXISTS idx_op_precio_detalle_producto
  ON public.operaciones_masivas_precio_detalle(producto_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2) RLS: igual que operaciones_masivas (solo SELECT por empresa; escriben las RPCs)
-- ----------------------------------------------------------------------------
ALTER TABLE public.operaciones_masivas_precio_detalle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operaciones_masivas_precio_detalle_select ON public.operaciones_masivas_precio_detalle;
CREATE POLICY operaciones_masivas_precio_detalle_select
  ON public.operaciones_masivas_precio_detalle FOR SELECT
  USING (es_superadmin() OR empresa_id = get_empresa_id());

-- Sin policy de INSERT/UPDATE/DELETE: solo las RPCs SECURITY DEFINER escriben.

-- ----------------------------------------------------------------------------
-- 3) Inmutabilidad: bloquear UPDATE y DELETE (defense in depth, igual que audit_log)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_precio_detalle_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'El detalle de precios es inmutable. No se permiten UPDATE ni DELETE.';
END;
$function$;

DROP TRIGGER IF EXISTS trg_precio_detalle_no_update ON public.operaciones_masivas_precio_detalle;
CREATE TRIGGER trg_precio_detalle_no_update
  BEFORE UPDATE ON public.operaciones_masivas_precio_detalle
  FOR EACH ROW EXECUTE FUNCTION public.prevent_precio_detalle_changes();

DROP TRIGGER IF EXISTS trg_precio_detalle_no_delete ON public.operaciones_masivas_precio_detalle;
CREATE TRIGGER trg_precio_detalle_no_delete
  BEFORE DELETE ON public.operaciones_masivas_precio_detalle
  FOR EACH ROW EXECUTE FUNCTION public.prevent_precio_detalle_changes();

-- ----------------------------------------------------------------------------
-- 4) productos_bulk_precio_individual: igual que en 022 + escribe el detalle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.productos_bulk_precio_individual(
  p_usuario_id uuid,
  p_cambios jsonb,
  p_motivo text DEFAULT NULL,
  p_accion text DEFAULT 'precio_individual'
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
  v_parametros jsonb;
  v_detalle jsonb := '[]'::jsonb;
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

  -- ===== Validación de los parámetros nuevos =====
  IF p_accion NOT IN ('precio_individual', 'aumento_workspace') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion;
  END IF;
  IF p_motivo IS NOT NULL AND length(btrim(p_motivo)) > 200 THEN
    RAISE EXCEPTION 'El motivo no puede superar 200 caracteres';
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

  -- ===== Snapshot del precio ANTERIOR (antes del UPDATE) + nombre/sku =====
  -- Solo productos válidos (de la empresa); coincide con el set que se actualiza.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'nombre', p.nombre,
           'sku', p.sku_base,
           'precio_anterior', p.precio_neto,
           'precio_nuevo', round(c.precio, 2)
         )), '[]'::jsonb)
  INTO v_detalle
  FROM jsonb_to_recordset(p_cambios) AS c(id uuid, precio numeric)
  JOIN public.productos p ON p.id = c.id AND p.empresa_id = v_empresa_id;

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

  -- ===== Parámetros de auditoría (motivo va dentro de parametros cuando viene) =====
  v_parametros := jsonb_build_object('tipo', 'individual')
    || CASE
         WHEN p_motivo IS NOT NULL AND length(btrim(p_motivo)) > 0
           THEN jsonb_build_object('motivo', btrim(p_motivo))
         ELSE '{}'::jsonb
       END;

  -- ===== Auditoría (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    p_accion, v_parametros,
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  -- ===== Detalle de precios (misma tx) =====
  INSERT INTO public.operaciones_masivas_precio_detalle (
    operacion_id, empresa_id, producto_id,
    producto_nombre_snapshot, producto_sku_snapshot,
    precio_anterior, precio_nuevo
  )
  SELECT v_operacion_id, v_empresa_id,
         (item->>'id')::uuid, item->>'nombre', item->>'sku',
         (item->>'precio_anterior')::numeric, (item->>'precio_nuevo')::numeric
  FROM jsonb_array_elements(v_detalle) AS item;

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

REVOKE EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.productos_bulk_precio_individual(uuid, jsonb, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5) revertir_operacion_precios: restaura bit-exact desde el detalle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revertir_operacion_precios(
  p_usuario_id uuid,
  p_operacion_original_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_op_empresa_id uuid;
  v_op_accion text;
  v_op_creada_at timestamptz;
  v_op_motivo text;
  v_horas numeric;
  v_tocados integer;
  v_nueva_operacion_id uuid;
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
    RAISE EXCEPTION 'Solo admin puede revertir precios';
  END IF;

  -- ===== Empresa =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Operación original =====
  SELECT empresa_id, accion, creado_at, parametros->>'motivo'
  INTO v_op_empresa_id, v_op_accion, v_op_creada_at, v_op_motivo
  FROM public.operaciones_masivas
  WHERE id = p_operacion_original_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La operación no existe';
  END IF;
  IF v_op_empresa_id <> v_empresa_id THEN
    RAISE EXCEPTION 'La operación no existe';
  END IF;

  -- Debe tener detalle (Fase B). Las históricas pre-023 no lo tienen.
  IF NOT EXISTS (
    SELECT 1 FROM public.operaciones_masivas_precio_detalle
    WHERE operacion_id = p_operacion_original_id
  ) THEN
    RAISE EXCEPTION 'La operación no tiene detalle de precios (anterior a Fase B)';
  END IF;

  -- ===== Condición 1: no revertida todavía =====
  IF EXISTS (
    SELECT 1 FROM public.operaciones_masivas
    WHERE empresa_id = v_empresa_id
      AND accion = 'reversion_precios'
      AND (parametros->>'operacion_original_id')::uuid = p_operacion_original_id
  ) THEN
    RAISE EXCEPTION 'La operación ya fue revertida';
  END IF;

  -- ===== Condición 2: ventana de 24h =====
  v_horas := EXTRACT(EPOCH FROM (now() - v_op_creada_at)) / 3600.0;
  IF v_horas > 24 THEN
    RAISE EXCEPTION 'La operación es de hace más de 24h. No se puede revertir.';
  END IF;

  -- ===== Condición 3: es la operación de precios más reciente =====
  IF EXISTS (
    SELECT 1 FROM public.operaciones_masivas
    WHERE empresa_id = v_empresa_id
      AND accion IN ('precio_individual', 'precio_pct', 'precio_fijo', 'aumento_workspace', 'reversion_precios')
      AND id <> p_operacion_original_id
      AND creado_at > v_op_creada_at
  ) THEN
    RAISE EXCEPTION 'Hay una operación de precios posterior. Solo se puede revertir la última.';
  END IF;

  -- ===== Condición 4: ningún producto del set fue tocado después =====
  -- Margen de 5s: el propio UPDATE de la operación dejó updated_at ~= creado_at.
  SELECT count(*)
  INTO v_tocados
  FROM public.operaciones_masivas_precio_detalle d
  JOIN public.productos p ON p.id = d.producto_id
  WHERE d.operacion_id = p_operacion_original_id
    AND p.updated_at > v_op_creada_at + interval '5 seconds';
  IF v_tocados > 0 THEN
    RAISE EXCEPTION 'Hay % producto(s) editados después de la operación. No se puede revertir.', v_tocados;
  END IF;

  -- ===== Aplicar reversión: restaurar precio_anterior bit-exact =====
  UPDATE public.productos p
  SET precio_neto = d.precio_anterior
  FROM public.operaciones_masivas_precio_detalle d
  WHERE d.operacion_id = p_operacion_original_id
    AND p.id = d.producto_id
    AND p.empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_afectados = ROW_COUNT;

  -- Operación nueva (NO se modifica la original)
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'reversion_precios',
    jsonb_build_object(
      'operacion_original_id', p_operacion_original_id,
      'operacion_original_accion', v_op_accion,
      'operacion_original_motivo', v_op_motivo,
      'motivo', format('Reversión de operación %s', p_operacion_original_id)
    ),
    v_afectados, v_afectados, 0, '[]'::jsonb, '[]'::jsonb
  )
  RETURNING id INTO v_nueva_operacion_id;

  -- Detalle de la reversión: anterior = precio post-aumento, nuevo = precio restaurado
  INSERT INTO public.operaciones_masivas_precio_detalle (
    operacion_id, empresa_id, producto_id,
    producto_nombre_snapshot, producto_sku_snapshot,
    precio_anterior, precio_nuevo
  )
  SELECT v_nueva_operacion_id, v_empresa_id, d.producto_id,
         d.producto_nombre_snapshot, d.producto_sku_snapshot,
         d.precio_nuevo, d.precio_anterior
  FROM public.operaciones_masivas_precio_detalle d
  WHERE d.operacion_id = p_operacion_original_id;

  RETURN jsonb_build_object(
    'ok', true,
    'nueva_operacion_id', v_nueva_operacion_id,
    'afectados', v_afectados
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.revertir_operacion_precios(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revertir_operacion_precios(uuid, uuid) TO authenticated;
