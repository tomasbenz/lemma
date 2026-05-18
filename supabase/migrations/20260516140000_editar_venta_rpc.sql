-- ============================================================
-- Feature: editar items de venta CERRADA (con o sin factura AFIP)
--
-- RPC editar_venta(p_venta_id, p_usuario_id, p_items_nuevos, p_ip, p_user_agent)
--
-- Criterio de negocio (Iconic Fashion): la factura AFIP es fiscal
-- inmutable. Cuando hay factura emitida y se necesita corregir items,
-- la solucion correcta es emitir nota de credito. Pero el cliente
-- necesita poder editar la VENTA igual (para reporting interno).
-- Entonces: dejamos la factura intacta + actualizamos venta, items,
-- stock. La discrepancia con AFIP queda asentada en el audit_log.
--
-- Diferencias con editar_pedido:
--   - Solo valida estado = 'cerrada' (NO 'guardada').
--   - SI ajusta stock (delta vs viejo) usando ajustar_stock(... true)
--     para permitir negativos en casos donde la edicion deja
--     desbalanceado el stock real vs declarado.
--   - NO toca descuento_total, recargos, medios_pago, facturas_afip,
--     monto_facturado, tipo_factura, estado_facturacion_afip.
--   - Recalcula total preservando descuento + recargo proporcional.
--   - Audit log incluye snapshot de items, factura info (si la hay),
--     y lista de ajustes de stock aplicados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.editar_venta(
  p_venta_id uuid,
  p_usuario_id uuid,
  p_items_nuevos jsonb,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
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
  -- Vars de delta de stock (loop)
  r_delta record;
BEGIN
  -- Anti-suplantacion
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'El usuario no coincide con el caller autenticado';
  END IF;

  -- Resolver caller
  SELECT email, empresa_id, rol
  INTO v_usuario_email, v_usuario_empresa_id, v_usuario_rol
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  IF v_usuario_rol = 'vendedor' THEN
    RAISE EXCEPTION 'No tenes permisos para editar ventas';
  END IF;

  -- Validar payload
  IF p_items_nuevos IS NULL
     OR jsonb_typeof(p_items_nuevos) <> 'array'
     OR jsonb_array_length(p_items_nuevos) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un item';
  END IF;

  v_cantidad_items := jsonb_array_length(p_items_nuevos);

  -- Lock venta y validar estado cerrada + empresa
  SELECT estado, empresa_id, numero, subtotal_neto, total,
         descuento_total, recargo_factura_completa, recargo_porcentaje_manual
  INTO v_estado, v_empresa_id, v_numero, v_subtotal_viejo, v_total_viejo,
       v_descuento_total, v_recargo_factura_completa, v_recargo_porcentaje_manual
  FROM public.ventas
  WHERE id = p_venta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La venta no se puede editar';
  END IF;

  IF v_estado <> 'cerrada' THEN
    RAISE EXCEPTION 'Solo se pueden editar ventas cerradas';
  END IF;

  IF v_usuario_empresa_id IS NOT NULL
     AND v_empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'La venta no se puede editar';
  END IF;

  -- Validar cada item del payload
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    IF (v_item->>'variante_id') IS NULL
       OR (v_item->>'cantidad') IS NULL
       OR (v_item->>'precio_unitario_neto') IS NULL
       OR (v_item->>'subtotal_neto') IS NULL THEN
      RAISE EXCEPTION 'Item invalido en el payload';
    END IF;

    IF (v_item->>'cantidad')::int <= 0 THEN
      RAISE EXCEPTION 'Cantidad debe ser mayor a cero';
    END IF;

    IF (v_item->>'precio_unitario_neto')::numeric < 0 THEN
      RAISE EXCEPTION 'Precio unitario no puede ser negativo';
    END IF;

    v_variante_id := (v_item->>'variante_id')::uuid;

    SELECT empresa_id, activa
    INTO v_variante_empresa_id, v_variante_activa
    FROM public.variantes
    WHERE id = v_variante_id;

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

  -- Snapshot items viejos para audit log
  SELECT COALESCE(jsonb_agg(to_jsonb(iv.*) ORDER BY iv.created_at), '[]'::jsonb)
  INTO v_items_viejos
  FROM public.items_venta iv
  WHERE iv.venta_id = p_venta_id;

  -- Detectar factura aprobada activa (snapshot para audit)
  SELECT EXISTS (
    SELECT 1 FROM public.facturas_afip
    WHERE venta_id = p_venta_id
      AND estado IN ('aprobada', 'aprobada_sin_persistir')
      AND factura_asociada_id IS NULL
  ) INTO v_tenia_factura;

  IF v_tenia_factura THEN
    SELECT jsonb_build_object(
      'numero', numero_comprobante,
      'tipo', tipo_factura,
      'cae', cae,
      'punto_venta', punto_venta
    )
    INTO v_factura_info
    FROM public.facturas_afip
    WHERE venta_id = p_venta_id
      AND estado IN ('aprobada', 'aprobada_sin_persistir')
      AND factura_asociada_id IS NULL
    LIMIT 1;
  ELSE
    v_factura_info := NULL;
  END IF;

  -- Ajustar stock: calcular delta por variante (nuevo - viejo)
  v_motivo_ajuste := 'Edicion venta #' || v_numero;

  FOR r_delta IN
    WITH viejos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id,
             COALESCE((e->>'cantidad')::int, 0) AS cantidad
      FROM jsonb_array_elements(v_items_viejos) e
    ),
    nuevos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id,
             SUM((e->>'cantidad')::int) AS cantidad
      FROM jsonb_array_elements(p_items_nuevos) e
      GROUP BY (e->>'variante_id')::uuid
    ),
    viejos_agg AS (
      SELECT variante_id, SUM(cantidad) AS cantidad
      FROM viejos
      GROUP BY variante_id
    )
    SELECT
      COALESCE(n.variante_id, v.variante_id) AS variante_id,
      COALESCE(n.cantidad, 0) - COALESCE(v.cantidad, 0) AS delta_items
    FROM viejos_agg v
    FULL OUTER JOIN nuevos n ON v.variante_id = n.variante_id
  LOOP
    -- delta_items > 0 -> mas items en la venta -> sacar stock (negativo)
    -- delta_items < 0 -> menos items en la venta -> devolver stock (positivo)
    -- delta_items = 0 -> skip
    IF r_delta.delta_items = 0 THEN
      CONTINUE;
    END IF;

    PERFORM public.ajustar_stock(
      r_delta.variante_id,
      -r_delta.delta_items,
      v_motivo_ajuste,
      p_usuario_id,
      true  -- permitir_negativo
    );

    v_stock_ajustes := v_stock_ajustes || jsonb_build_array(
      jsonb_build_object(
        'variante_id', r_delta.variante_id,
        'delta_items', r_delta.delta_items,
        'delta_aplicado', -r_delta.delta_items,
        'motivo', v_motivo_ajuste
      )
    );
    v_stock_ajustes_count := v_stock_ajustes_count + 1;
  END LOOP;

  -- Reemplazo de items
  DELETE FROM public.items_venta WHERE venta_id = p_venta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    INSERT INTO public.items_venta (
      venta_id,
      variante_id,
      producto_nombre,
      producto_sku,
      variante_sku,
      variante_color,
      variante_talle,
      cantidad,
      precio_unitario_neto,
      subtotal_neto,
      empresa_id
    ) VALUES (
      p_venta_id,
      (v_item->>'variante_id')::uuid,
      v_item->>'producto_nombre',
      v_item->>'producto_sku',
      v_item->>'variante_sku',
      v_item->>'variante_color',
      v_item->>'variante_talle',
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario_neto')::numeric,
      (v_item->>'subtotal_neto')::numeric,
      v_empresa_id
    );

    v_subtotal_nuevo := v_subtotal_nuevo + (v_item->>'subtotal_neto')::numeric;
  END LOOP;

  -- Recalcular total preservando descuento + recargo
  v_base_con_descuento := v_subtotal_nuevo - COALESCE(v_descuento_total, 0);
  IF v_base_con_descuento < 0 THEN
    v_base_con_descuento := 0;
  END IF;

  IF v_recargo_factura_completa THEN
    v_total_nuevo := round(v_base_con_descuento * 1.105, 2);
  ELSIF v_recargo_porcentaje_manual IS NOT NULL THEN
    v_total_nuevo := round(
      v_base_con_descuento * (1 + v_recargo_porcentaje_manual / 100),
      2
    );
  ELSE
    v_total_nuevo := round(v_base_con_descuento, 2);
  END IF;

  -- Update venta (NO tocar descuento, recargos, factura, medios)
  UPDATE public.ventas
  SET subtotal_neto = v_subtotal_nuevo,
      total = v_total_nuevo,
      updated_at = NOW()
  WHERE id = p_venta_id;

  -- Audit log
  INSERT INTO public.audit_log (
    usuario_id,
    usuario_email_snapshot,
    entidad,
    entidad_id,
    accion,
    detalle,
    ip,
    user_agent,
    empresa_id
  ) VALUES (
    auth.uid(),
    v_usuario_email,
    'venta',
    p_venta_id::text,
    'editar_venta',
    jsonb_build_object(
      'items_antes', v_items_viejos,
      'items_despues', p_items_nuevos,
      'subtotal_antes', v_subtotal_viejo,
      'subtotal_despues', v_subtotal_nuevo,
      'total_antes', v_total_viejo,
      'total_despues', v_total_nuevo,
      'tenia_factura_aprobada', v_tenia_factura,
      'factura_info', v_factura_info,
      'stock_ajustes', v_stock_ajustes
    ),
    p_ip::inet,
    p_user_agent,
    v_empresa_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', p_venta_id,
    'subtotal_neto', v_subtotal_nuevo,
    'total', v_total_nuevo,
    'cantidad_items', v_cantidad_items,
    'stock_ajustes_count', v_stock_ajustes_count,
    'tenia_factura', v_tenia_factura
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) IS
  'Edita items de venta cerrada ajustando stock. NO toca factura AFIP, medios de pago, ni descuentos.';
