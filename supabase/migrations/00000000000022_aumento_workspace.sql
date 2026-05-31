-- ============================================================================
-- Migración 022 — Aumento workspace (estilo SAP)
-- ============================================================================
--
-- La pantalla /admin/productos/aumentos se rediseñó: el modelo "un % por
-- categoría en una operación" (Fase A, migración 021) se descartó. El caso real
-- de Samu es más granular (combinaciones marca+categoría con %s distintos), y se
-- resuelve mejor con un workspace: filtros + tabla + selección + un % aplicado al
-- set filtrado. Una operación = un % sobre un set = una fila de audit.
--
-- Por eso esta migración:
--
--  1) DROPEA las funciones de la migración 021 (modelo viejo, ya no se usan):
--       - aumentar_precios_por_categoria(uuid, uuid, jsonb, text, text)
--       - _redondear_precio(numeric, text)   [el redondeo ahora vive solo en TS,
--         en src/lib/precios/redondeo.ts]
--
--  2) EXTIENDE productos_bulk_precio_individual (migración 010) en vez de crear
--     una RPC nueva: el workspace reusa esta RPC que ya aplica una lista
--     [{id, precio}] de forma atómica y audita en operaciones_masivas. Se le
--     agregan dos parámetros OPCIONALES al final (backward compatible):
--       - p_motivo text DEFAULT NULL    → se guarda en parametros JSONB
--       - p_accion text DEFAULT 'precio_individual' → permite distinguir el
--         origen ('aumento_workspace' vs el bulk normal de la pantalla principal)
--
--     El cuerpo es idéntico a la versión 010 salvo esos agregados. Las llamadas
--     existentes (2 args nombrados) siguen funcionando vía los defaults.
--
-- NOTA: hay que DROPEAR la versión vieja de 2 args antes de crear la de 4 args;
-- si no, Postgres deja las dos como overloads y una llamada de 2 args queda
-- ambigua.
--
-- IMPORTANTE: NO aplicar a prod automáticamente. Tomás la aplica a mano.
-- Coordinar con el deploy del código del workspace (el código nuevo llama a la
-- RPC con p_accion='aumento_workspace', que sólo existe tras esta migración).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Cleanup del modelo viejo (migración 021)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.aumentar_precios_por_categoria(uuid, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public._redondear_precio(numeric, text);

-- ----------------------------------------------------------------------------
-- 2) productos_bulk_precio_individual extendida (motivo + accion)
-- ----------------------------------------------------------------------------
-- Dropear la versión vieja de 2 args para no dejar overloads ambiguos.
DROP FUNCTION IF EXISTS public.productos_bulk_precio_individual(uuid, jsonb);

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
