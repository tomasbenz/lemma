-- ============================================================================
-- 00000000000032_combos_editar_anular_venta.sql
-- ----------------------------------------------------------------------------
-- FEATURE COMBOS — Migración D2 (de 2): revert de stock con snapshot.
--
-- Usa items_venta_componentes (mig 031) para revertir stock EXACTO al editar o
-- anular una venta cerrada que contiene combos, aunque la receta del combo haya
-- cambiado después de la venta.
--
--   * editar_venta: separa el ajuste de stock en dos:
--       3a) variantes NO-combo → delta por variante (lógica existente).
--       3b) componentes de combos → net entre el consumo VIEJO (snapshot) y el
--           consumo NUEVO (receta actual de los combos del payload). Lee el
--           snapshot ANTES del DELETE de items_venta. Re-snapshotea al recrear.
--       La variante default del combo (track_stock=false) NO se ajusta nunca.
--   * anular_venta: además de revertir las variantes directas, restaura los
--     componentes sumando cantidad_consumida del snapshot. Las filas del
--     snapshot se conservan (histórico).
--
-- editar_venta usa ajustar_stock(permitir_negativo=true), consistente con su
-- semántica actual (editar una venta cerrada es una corrección que puede dejar
-- stock negativo). anular_venta solo SUMA stock (siempre seguro).
--
-- IMPORTANTE: NO se aplica automáticamente. Tomás la aplica a mano + db:types.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) editar_venta — cuerpo de mig 003 + cascada de combos por delta/net.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_venta(
  p_venta_id uuid,
  p_usuario_id uuid,
  p_items_nuevos jsonb,
  p_ip text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_email text;
  v_usuario_empresa_id uuid;
  v_usuario_rol user_role;
  v_empresa_id uuid;
  v_estado venta_estado;
  v_numero int;
  v_descuento_total numeric;
  v_recargo_factura_completa boolean;
  v_recargo_porcentaje_manual numeric;
  v_subtotal_viejo numeric;
  v_total_viejo numeric;
  v_items_viejos jsonb;
  v_subtotal_nuevo numeric := 0;
  v_total_nuevo numeric;
  v_base_con_descuento numeric;
  v_item jsonb;
  v_variante_id uuid;
  v_variante_empresa_id uuid;
  v_variante_activa boolean;
  v_cantidad_items int;
  v_tenia_factura boolean;
  v_factura_info jsonb;
  v_stock_ajustes jsonb := '[]'::jsonb;
  v_stock_ajustes_count int := 0;
  v_motivo_ajuste text;
  r_delta record;
  -- NUEVO (combos)
  r_comp_delta record;
  v_item_venta_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'El usuario no coincide con el caller autenticado';
  END IF;
  SELECT email, empresa_id, rol INTO v_usuario_email, v_usuario_empresa_id, v_usuario_rol
  FROM public.usuarios WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_usuario_rol = 'vendedor' THEN
    RAISE EXCEPTION 'No tenes permisos para editar ventas';
  END IF;
  IF p_items_nuevos IS NULL OR jsonb_typeof(p_items_nuevos) <> 'array' OR jsonb_array_length(p_items_nuevos) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un item';
  END IF;
  v_cantidad_items := jsonb_array_length(p_items_nuevos);
  SELECT estado, empresa_id, numero, subtotal_neto, total, descuento_total, recargo_factura_completa, recargo_porcentaje_manual
  INTO v_estado, v_empresa_id, v_numero, v_subtotal_viejo, v_total_viejo, v_descuento_total, v_recargo_factura_completa, v_recargo_porcentaje_manual
  FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La venta no se puede editar';
  END IF;
  IF v_estado <> 'cerrada' THEN
    RAISE EXCEPTION 'Solo se pueden editar ventas cerradas';
  END IF;
  IF v_usuario_empresa_id IS NOT NULL AND v_empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'La venta no se puede editar';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    IF (v_item->>'variante_id') IS NULL OR (v_item->>'cantidad') IS NULL OR (v_item->>'precio_unitario_neto') IS NULL OR (v_item->>'subtotal_neto') IS NULL THEN
      RAISE EXCEPTION 'Item invalido en el payload';
    END IF;
    IF (v_item->>'cantidad')::int <= 0 THEN
      RAISE EXCEPTION 'Cantidad debe ser mayor a cero';
    END IF;
    IF (v_item->>'precio_unitario_neto')::numeric < 0 THEN
      RAISE EXCEPTION 'Precio unitario no puede ser negativo';
    END IF;
    v_variante_id := (v_item->>'variante_id')::uuid;
    SELECT empresa_id, activa INTO v_variante_empresa_id, v_variante_activa FROM public.variantes WHERE id = v_variante_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La variante no existe';
    END IF;
    IF NOT v_variante_activa THEN
      RAISE EXCEPTION 'La variante no esta activa';
    END IF;
    IF v_variante_empresa_id <> v_empresa_id THEN
      RAISE EXCEPTION 'La variante no pertenece a la empresa';
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(iv.*) ORDER BY iv.created_at), '[]'::jsonb) INTO v_items_viejos
  FROM public.items_venta iv WHERE iv.venta_id = p_venta_id;
  SELECT EXISTS (SELECT 1 FROM public.facturas_afip WHERE venta_id = p_venta_id AND estado IN ('aprobada', 'aprobada_sin_persistir') AND factura_asociada_id IS NULL) INTO v_tenia_factura;
  IF v_tenia_factura THEN
    SELECT jsonb_build_object('numero', numero_comprobante, 'tipo', tipo_factura, 'cae', cae, 'punto_venta', punto_venta) INTO v_factura_info
    FROM public.facturas_afip WHERE venta_id = p_venta_id AND estado IN ('aprobada', 'aprobada_sin_persistir') AND factura_asociada_id IS NULL LIMIT 1;
  ELSE
    v_factura_info := NULL;
  END IF;
  v_motivo_ajuste := 'Edicion venta #' || v_numero;

  -- 3a. Delta de variantes NO-combo (lógica existente, excluyendo combos).
  FOR r_delta IN
    WITH viejos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id, SUM((e->>'cantidad')::int)::int AS cantidad
      FROM jsonb_array_elements(v_items_viejos) e GROUP BY (e->>'variante_id')::uuid
    ),
    nuevos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id, SUM((e->>'cantidad')::int)::int AS cantidad
      FROM jsonb_array_elements(p_items_nuevos) e GROUP BY (e->>'variante_id')::uuid
    ),
    deltas AS (
      SELECT COALESCE(n.variante_id, v.variante_id) AS variante_id,
             (COALESCE(n.cantidad, 0) - COALESCE(v.cantidad, 0))::int AS delta_items
      FROM viejos v FULL OUTER JOIN nuevos n ON v.variante_id = n.variante_id
    )
    SELECT d.variante_id, d.delta_items
    FROM deltas d
    JOIN public.variantes vr ON vr.id = d.variante_id
    JOIN public.productos p ON p.id = vr.producto_id
    WHERE p.es_combo = false
  LOOP
    IF r_delta.delta_items = 0 THEN
      CONTINUE;
    END IF;
    PERFORM public.ajustar_stock(r_delta.variante_id, (-r_delta.delta_items)::int, v_motivo_ajuste, p_usuario_id, true);
    v_stock_ajustes := v_stock_ajustes || jsonb_build_array(jsonb_build_object('variante_id', r_delta.variante_id, 'delta_items', r_delta.delta_items, 'delta_aplicado', -r_delta.delta_items, 'motivo', v_motivo_ajuste));
    v_stock_ajustes_count := v_stock_ajustes_count + 1;
  END LOOP;

  -- 3b. Net de componentes de combos: consumo VIEJO (snapshot, leído ANTES del
  -- DELETE) vs consumo NUEVO (receta actual de los combos del payload).
  FOR r_comp_delta IN
    WITH viejo_consumo AS (
      SELECT ivc.componente_variante_id AS variante_id, SUM(ivc.cantidad_consumida)::int AS cantidad
      FROM public.items_venta_componentes ivc
      JOIN public.items_venta iv ON iv.id = ivc.item_venta_id
      WHERE iv.venta_id = p_venta_id
      GROUP BY ivc.componente_variante_id
    ),
    nuevo_consumo AS (
      SELECT cc.componente_variante_id AS variante_id,
             SUM(((e->>'cantidad')::int) * cc.cantidad)::int AS cantidad
      FROM jsonb_array_elements(p_items_nuevos) e
      JOIN public.variantes vr ON vr.id = (e->>'variante_id')::uuid
      JOIN public.productos p ON p.id = vr.producto_id AND p.es_combo = true
      JOIN public.combo_componentes cc ON cc.combo_id = p.id
      GROUP BY cc.componente_variante_id
    )
    SELECT COALESCE(n.variante_id, v.variante_id) AS variante_id,
           (COALESCE(n.cantidad, 0) - COALESCE(v.cantidad, 0))::int AS delta
    FROM viejo_consumo v FULL OUTER JOIN nuevo_consumo n ON v.variante_id = n.variante_id
  LOOP
    IF r_comp_delta.delta = 0 THEN
      CONTINUE;
    END IF;
    PERFORM public.ajustar_stock(r_comp_delta.variante_id, (-r_comp_delta.delta)::int, v_motivo_ajuste, p_usuario_id, true);
    v_stock_ajustes := v_stock_ajustes || jsonb_build_array(jsonb_build_object('componente_variante_id', r_comp_delta.variante_id, 'delta_consumo', r_comp_delta.delta, 'delta_aplicado', -r_comp_delta.delta, 'motivo', v_motivo_ajuste, 'origen', 'combo'));
    v_stock_ajustes_count := v_stock_ajustes_count + 1;
  END LOOP;

  -- 4. Recrear items_venta (CASCADE borra el snapshot viejo) + snapshot nuevo.
  DELETE FROM public.items_venta WHERE venta_id = p_venta_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    INSERT INTO public.items_venta (
      venta_id, variante_id, producto_nombre, producto_sku, variante_sku,
      variante_atributos, cantidad, precio_unitario_neto, subtotal_neto, empresa_id
    )
    VALUES (
      p_venta_id, (v_item->>'variante_id')::uuid, v_item->>'producto_nombre',
      v_item->>'producto_sku', v_item->>'variante_sku',
      COALESCE(v_item->'variante_atributos', '{}'::jsonb),
      (v_item->>'cantidad')::int, (v_item->>'precio_unitario_neto')::numeric,
      (v_item->>'subtotal_neto')::numeric, v_empresa_id
    )
    RETURNING id INTO v_item_venta_id;

    -- Snapshot del consumo si el item es combo (receta actual). El INSERT...SELECT
    -- no inserta nada para items no-combo (el JOIN a es_combo=true filtra).
    INSERT INTO public.items_venta_componentes (empresa_id, item_venta_id, componente_variante_id, cantidad_consumida)
    SELECT v_empresa_id, v_item_venta_id, cc.componente_variante_id, (v_item->>'cantidad')::int * cc.cantidad
    FROM public.variantes vr
    JOIN public.productos p ON p.id = vr.producto_id AND p.es_combo = true
    JOIN public.combo_componentes cc ON cc.combo_id = p.id
    WHERE vr.id = (v_item->>'variante_id')::uuid;

    v_subtotal_nuevo := v_subtotal_nuevo + (v_item->>'subtotal_neto')::numeric;
  END LOOP;
  v_base_con_descuento := v_subtotal_nuevo - COALESCE(v_descuento_total, 0);
  IF v_base_con_descuento < 0 THEN
    v_base_con_descuento := 0;
  END IF;
  IF v_recargo_factura_completa THEN
    v_total_nuevo := round(v_base_con_descuento * 1.105, 2);
  ELSIF v_recargo_porcentaje_manual IS NOT NULL THEN
    v_total_nuevo := round(v_base_con_descuento * (1 + v_recargo_porcentaje_manual / 100), 2);
  ELSE
    v_total_nuevo := round(v_base_con_descuento, 2);
  END IF;
  UPDATE public.ventas SET subtotal_neto = v_subtotal_nuevo, total = v_total_nuevo, updated_at = NOW() WHERE id = p_venta_id;
  INSERT INTO public.audit_log (usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle, ip, user_agent, empresa_id)
  VALUES (auth.uid(), v_usuario_email, 'venta', p_venta_id, 'editar_venta',
    jsonb_build_object('items_antes', v_items_viejos, 'items_despues', p_items_nuevos, 'subtotal_antes', v_subtotal_viejo, 'subtotal_despues', v_subtotal_nuevo, 'total_antes', v_total_viejo, 'total_despues', v_total_nuevo, 'tenia_factura_aprobada', v_tenia_factura, 'factura_info', v_factura_info, 'stock_ajustes', v_stock_ajustes),
    p_ip::inet, p_user_agent, v_empresa_id);
  RETURN jsonb_build_object('ok', true, 'venta_id', p_venta_id, 'subtotal_neto', v_subtotal_nuevo, 'total', v_total_nuevo, 'cantidad_items', v_cantidad_items, 'stock_ajustes_count', v_stock_ajustes_count, 'tenia_factura', v_tenia_factura);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2) anular_venta — cuerpo de mig 003 + restauración de componentes de combos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_venta(
  p_venta_id uuid,
  p_motivo text,
  p_ip inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text
)
RETURNS public.ventas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venta public.ventas;
  v_usuario_email text;
  v_usuario_empresa_id uuid;
  v_usuario_rol user_role;
  v_usuario_existe boolean;
  v_factura_activa_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede anular ventas';
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT empresa_id, rol, true
  INTO v_usuario_empresa_id, v_usuario_rol, v_usuario_existe
  FROM public.usuarios
  WHERE id = auth.uid() AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  SELECT * INTO v_venta FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_usuario_empresa_id IS NOT NULL
     AND v_venta.empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'No tenés permisos para anular esta venta';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'La venta ya está anulada';
  END IF;

  -- Validación de factura aprobada activa.
  SELECT COUNT(*) INTO v_factura_activa_count
  FROM public.facturas_afip
  WHERE venta_id = p_venta_id
    AND estado = 'aprobada'
    AND factura_asociada_id IS NULL;

  IF v_factura_activa_count > 0 THEN
    RAISE EXCEPTION 'La venta tiene factura AFIP aprobada activa. Emitir Nota de Crédito antes de anular.';
  END IF;

  -- Si estaba cerrada, revertir stock leyendo de items_venta.
  IF v_venta.estado = 'cerrada' THEN
    -- Variantes directas (no-combo; combos tienen track_stock=false y se saltean).
    UPDATE public.variantes v
    SET stock = v.stock + iv.cantidad,
        updated_at = NOW()
    FROM public.items_venta iv, public.productos p
    WHERE iv.venta_id = p_venta_id
      AND iv.variante_id = v.id
      AND v.producto_id = p.id
      AND p.track_stock = true;

    -- NUEVO: restaurar componentes de combos desde el snapshot exacto.
    UPDATE public.variantes v
    SET stock = v.stock + ivc.cantidad_consumida,
        updated_at = NOW()
    FROM public.items_venta_componentes ivc
    JOIN public.items_venta iv ON iv.id = ivc.item_venta_id
    WHERE iv.venta_id = p_venta_id
      AND v.id = ivc.componente_variante_id;
  END IF;

  UPDATE public.ventas
  SET estado = 'anulada',
      updated_at = NOW(),
      nota_interna = COALESCE(nota_interna || E'\n---\nANULADA: ', 'ANULADA: ') || p_motivo
  WHERE id = p_venta_id
  RETURNING * INTO v_venta;

  SELECT email INTO v_usuario_email FROM public.usuarios WHERE id = auth.uid();

  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot,
    entidad, entidad_id, accion, detalle,
    ip, user_agent, empresa_id
  ) VALUES (
    auth.uid(), v_usuario_email,
    'venta', p_venta_id, 'anular',
    jsonb_build_object(
      'numero', v_venta.numero,
      'motivo', p_motivo,
      'estado_previo', v_venta.estado
    ),
    p_ip, p_user_agent, v_venta.empresa_id
  );

  RETURN v_venta;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_venta(uuid, text, inet, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.anular_venta(uuid, text, inet, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Smoke test
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_funcs integer;
BEGIN
  SELECT count(*) INTO v_funcs FROM pg_proc
  WHERE proname IN ('editar_venta', 'anular_venta')
    AND pronamespace = 'public'::regnamespace;
  IF v_funcs < 2 THEN
    RAISE EXCEPTION 'Faltan editar_venta/anular_venta (encontradas: %)', v_funcs;
  END IF;
  RAISE NOTICE 'OK: editar_venta + anular_venta con revert por snapshot (mig 032) aplicados.';
END;
$$;
