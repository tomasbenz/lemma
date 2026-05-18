-- ============================================================
-- Feature: editar items de pedidos en estado 'guardada' (solo admin)
--
-- RPC editar_pedido(p_pedido_id, p_usuario_id, p_items_nuevos, p_ip, p_user_agent)
--
-- Reemplaza completamente los items de un pedido en estado 'guardada'
-- (DELETE all + INSERT nuevos), recalcula subtotal y total, y deja
-- audit trail con snapshot completo del antes/despues.
--
-- Restricciones:
--   - SECURITY DEFINER con search_path fijo
--   - Anti-suplantacion: auth.uid() debe coincidir con p_usuario_id
--   - Rol vendedor bloqueado (solo admin/superadmin)
--   - Solo pedidos en estado 'guardada' de la misma empresa
--   - No toca stock: el stock se descuenta recien al finalizar
--   - No toca descuento_total: en 'guardada' siempre es 0 y total == subtotal_neto
--
-- Shape esperado de cada item en p_items_nuevos (jsonb array):
--   {
--     variante_id text,
--     producto_nombre text,
--     producto_sku text,
--     variante_sku text,
--     variante_color text|null,
--     variante_talle text|null,
--     cantidad int,
--     precio_unitario_neto numeric,
--     subtotal_neto numeric
--   }
-- ============================================================

CREATE OR REPLACE FUNCTION public.editar_pedido(
  p_pedido_id uuid,
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
  v_pedido_estado venta_estado;
  v_subtotal_viejo numeric;
  v_items_viejos jsonb;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_variante_id uuid;
  v_variante_empresa_id uuid;
  v_variante_activa boolean;
  v_cantidad_items int;
BEGIN
  -- Anti-suplantacion: el caller debe ser el mismo usuario que dice ser
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'El usuario no coincide con el caller autenticado';
  END IF;

  -- Resolver usuario (rechazar inactivo/inexistente)
  SELECT email, empresa_id, rol
  INTO v_usuario_email, v_usuario_empresa_id, v_usuario_rol
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  -- Bloquear vendedor explicitamente
  IF v_usuario_rol = 'vendedor' THEN
    RAISE EXCEPTION 'No tenes permisos para editar pedidos';
  END IF;

  -- Validar payload basico
  IF p_items_nuevos IS NULL
     OR jsonb_typeof(p_items_nuevos) <> 'array'
     OR jsonb_array_length(p_items_nuevos) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un item';
  END IF;

  v_cantidad_items := jsonb_array_length(p_items_nuevos);

  -- Validar pedido: existe, esta en guardada, y pertenece a la empresa del caller
  SELECT estado, empresa_id, subtotal_neto
  INTO v_pedido_estado, v_empresa_id, v_subtotal_viejo
  FROM public.ventas
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
  END IF;

  IF v_pedido_estado <> 'guardada' THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
  END IF;

  -- Multi-tenant guard (defense in depth sobre RLS).
  -- Excepcion: superadmin sin empresa activa (v_usuario_empresa_id IS NULL)
  -- puede operar en cualquier empresa al impersonar; en ese caso se confia
  -- en el setup de impersonacion + RLS.
  IF v_usuario_empresa_id IS NOT NULL
     AND v_empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
  END IF;

  -- Validar cada variante: existe, activa, y misma empresa
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    -- Validar shape minimo del item
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

  -- Snapshot de items viejos para audit log
  SELECT COALESCE(jsonb_agg(to_jsonb(iv.*) ORDER BY iv.created_at), '[]'::jsonb)
  INTO v_items_viejos
  FROM public.items_venta iv
  WHERE iv.venta_id = p_pedido_id;

  -- DELETE all + re-INSERT (mas simple y atomico que diff)
  DELETE FROM public.items_venta WHERE venta_id = p_pedido_id;

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
      p_pedido_id,
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

    v_subtotal := v_subtotal + (v_item->>'subtotal_neto')::numeric;
  END LOOP;

  -- Recalcular venta. En 'guardada' descuento_total siempre es 0
  -- y total == subtotal_neto.
  UPDATE public.ventas
  SET subtotal_neto = v_subtotal,
      total = v_subtotal,
      updated_at = NOW()
  WHERE id = p_pedido_id;

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
    p_pedido_id::text,
    'editar_pedido',
    jsonb_build_object(
      'items_antes', v_items_viejos,
      'items_despues', p_items_nuevos,
      'subtotal_antes', v_subtotal_viejo,
      'subtotal_despues', v_subtotal
    ),
    p_ip::inet,
    p_user_agent,
    v_empresa_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'pedido_id', p_pedido_id,
    'subtotal_neto', v_subtotal,
    'cantidad_items', v_cantidad_items
  );
END;
$function$;

-- Permisos: solo authenticated (anon no puede llamarla)
REVOKE EXECUTE ON FUNCTION public.editar_pedido(uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_pedido(uuid, uuid, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.editar_pedido(uuid, uuid, jsonb, text, text) IS
  'Reemplaza items de un pedido en estado guardada. Solo admin. No toca stock (se descuenta al finalizar).';
