-- ============================================================================
-- Migración 021 — Aumento de precios por categoría (Fase A)
-- ============================================================================
--
-- Fase A de la feature "Aumento por proveedor con desglose por categoría".
-- RPC única que aplica un % distinto por categoría en una sola transacción,
-- opcionalmente acotado por marca (proxy de proveedor), audita en
-- operaciones_masivas, SIN reversibilidad.
--
-- Diseño completo en docs/feature-aumento-por-categoria.md.
--
-- Decisiones cerradas (Fase A):
--   - Solo toca productos.precio_neto (+ variantes.precio_neto_override si != NULL).
--     NO toca costo.
--   - Redondeo configurable: none | r10 | r50 | r100 (default lo decide el cliente).
--   - Audit en operaciones_masivas (accion='aumento_categoria'). SIN tabla de
--     detalle y SIN reversibilidad (eso es Fase B).
--   - Solo admin/superadmin (es_admin()), patrón idéntico a productos_bulk_update.
--
-- Nota sobre `afectados`: se cuenta como ROW_COUNT del UPDATE (matched rows),
-- NO como changed rows. El redondeo puede dejar el precio igual al anterior
-- (ej: +0,5% a $100 con r100 = $100) y eso igual cuenta como afectado. No hay
-- forma barata de detectar "no cambió" sin un sub-select previo; se documenta.
--
-- ⚠️ Riesgo conocido del redondeo r100: un producto barato (ej. $46) redondea a
-- $0. El precio nunca queda negativo (GREATEST(..., 0)), pero puede quedar en 0.
-- El preview (server-side) avisa este caso ANTES de aplicar. Ver doc.
--
-- IMPORTANTE: NO aplicar a prod automáticamente. Tomás la aplica a mano.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper de redondeo. Espejo EXACTO de src/lib/precios/redondeo.ts.
-- round() de Postgres para numeric redondea "half away from zero"; para precios
-- (>= 0) coincide con Math.round de JS ("half up"). Por eso el espejo es válido.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._redondear_precio(p numeric, estrategia text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE estrategia
    WHEN 'none' THEN round(p, 2)
    WHEN 'r10'  THEN round(p / 10) * 10
    WHEN 'r50'  THEN round(p / 50) * 50
    WHEN 'r100' THEN round(p / 100) * 100
    ELSE round(p, 2)
  END;
$$;

-- ----------------------------------------------------------------------------
-- RPC principal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aumentar_precios_por_categoria(
  p_usuario_id uuid,
  p_marca_id uuid DEFAULT NULL,
  p_ajustes jsonb DEFAULT '[]'::jsonb,
  p_redondeo text DEFAULT 'r100',
  p_motivo text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_total_esperado integer := 0;
  v_afectados integer := 0;
  v_var_afectadas integer := 0;
  v_operacion_id uuid;
  v_por_categoria jsonb := '[]'::jsonb;
BEGIN
  -- ===== Auth (idéntico a productos_bulk_update) =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede aumentar precios en masa';
  END IF;

  -- ===== Empresa re-derivada (no se confía en el cliente) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación de parámetros =====
  IF p_redondeo IS NULL OR p_redondeo NOT IN ('none', 'r10', 'r50', 'r100') THEN
    RAISE EXCEPTION 'Estrategia de redondeo inválida: %', p_redondeo;
  END IF;

  IF p_motivo IS NULL OR length(btrim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;
  IF length(p_motivo) > 200 THEN
    RAISE EXCEPTION 'El motivo no puede superar 200 caracteres';
  END IF;

  IF p_ajustes IS NULL
     OR jsonb_typeof(p_ajustes) <> 'array'
     OR jsonb_array_length(p_ajustes) = 0 THEN
    RAISE EXCEPTION 'No hay ajustes por categoría';
  END IF;

  -- Estructura + rango de cada ajuste: categoria_id presente, pct finito y > -100.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_ajustes) AS a(categoria_id uuid, pct numeric)
    WHERE a.categoria_id IS NULL
       OR a.pct IS NULL
       OR a.pct <= -100
  ) THEN
    RAISE EXCEPTION 'Ajuste inválido: cada item requiere categoria_id y pct > -100';
  END IF;

  -- Marca (si viene) debe ser de la empresa.
  IF p_marca_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.marcas WHERE id = p_marca_id AND empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'La marca no existe';
  END IF;

  -- Todas las categorías del array deben pertenecer a la empresa.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_ajustes) AS a(categoria_id uuid, pct numeric)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.catalogo_categorias c
      WHERE c.id = a.categoria_id AND c.empresa_id = v_empresa_id
    )
  ) THEN
    RAISE EXCEPTION 'Una categoría no pertenece a la empresa';
  END IF;

  -- ===== Conteo esperado por categoría (ANTES del UPDATE) =====
  -- Solo categorías con pct <> 0 (las pct=0 no se tocan). Mismos filtros que el UPDATE.
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'categoria_id', t.categoria_id,
      'n_productos', t.n
    )), '[]'::jsonb),
    COALESCE(sum(t.n), 0)
  INTO v_por_categoria, v_total_esperado
  FROM (
    SELECT a.categoria_id, count(p.id) AS n
    FROM jsonb_to_recordset(p_ajustes) AS a(categoria_id uuid, pct numeric)
    JOIN public.productos p
      ON p.categoria_id = a.categoria_id
     AND p.empresa_id = v_empresa_id
     AND p.activo = true
     AND (p_marca_id IS NULL OR p.marca_id = p_marca_id)
    WHERE a.pct IS NOT NULL AND a.pct <> 0
    GROUP BY a.categoria_id
  ) t;

  -- ===== UPDATE productos (atómico, set-based) =====
  UPDATE public.productos p
  SET precio_neto = GREATEST(
        public._redondear_precio(p.precio_neto * (1 + a.pct / 100.0), p_redondeo),
        0
      )
  FROM jsonb_to_recordset(p_ajustes) AS a(categoria_id uuid, pct numeric)
  WHERE p.empresa_id = v_empresa_id
    AND p.activo = true
    AND p.categoria_id = a.categoria_id
    AND (p_marca_id IS NULL OR p.marca_id = p_marca_id)
    AND a.pct IS NOT NULL
    AND a.pct <> 0;
  GET DIAGNOSTICS v_afectados = ROW_COUNT;

  -- ===== UPDATE espejo de variantes con precio_neto_override (defensivo) =====
  -- Hoy hay 0 filas con override, pero si a futuro existen no deben quedar con
  -- el precio viejo. Mismo % y mismo redondeo.
  UPDATE public.variantes v
  SET precio_neto_override = GREATEST(
        public._redondear_precio(v.precio_neto_override * (1 + a.pct / 100.0), p_redondeo),
        0
      )
  FROM public.productos p, jsonb_to_recordset(p_ajustes) AS a(categoria_id uuid, pct numeric)
  WHERE v.producto_id = p.id
    AND v.empresa_id = v_empresa_id
    AND v.precio_neto_override IS NOT NULL
    AND p.empresa_id = v_empresa_id
    AND p.activo = true
    AND p.categoria_id = a.categoria_id
    AND (p_marca_id IS NULL OR p.marca_id = p_marca_id)
    AND a.pct IS NOT NULL
    AND a.pct <> 0;
  GET DIAGNOSTICS v_var_afectadas = ROW_COUNT;

  -- ===== Auditoría (atómica, en la misma tx) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'aumento_categoria',
    jsonb_build_object(
      'marca_id', p_marca_id,
      'redondeo', p_redondeo,
      'motivo', p_motivo,
      'ajustes', p_ajustes,
      'variantes_override_afectadas', v_var_afectadas
    ),
    v_total_esperado,
    v_afectados,
    GREATEST(v_total_esperado - v_afectados, 0),
    '[]'::jsonb,   -- Fase A no rastrea omitidos individuales
    '[]'::jsonb    -- Fase A no guarda ids_afectados (la tabla de detalle es Fase B)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operacion_id', v_operacion_id,
    'afectados', v_afectados,
    'variantes_override_afectadas', v_var_afectadas,
    'por_categoria', v_por_categoria
  );
END;
$function$;
