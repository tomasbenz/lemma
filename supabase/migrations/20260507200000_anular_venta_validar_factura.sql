-- ============================================================
-- Sprint 3 / T3.b: anular_venta valida factura aprobada activa
--
-- Defense-in-depth: si alguien llama directo a anular_venta saltándose
-- el server action TS (script, otro server action, mantenimiento manual),
-- la función PG bloquea la anulación si hay factura AFIP aprobada activa
-- (no anulada_por_nc). El flujo correcto es: emitirNotaCreditoAfip primero,
-- después anular.
--
-- NO se modifica el resto de la función — solo se agrega la validación
-- nueva. La estructura existente se preserva al pie de la letra.
-- ============================================================

CREATE OR REPLACE FUNCTION public.anular_venta(
  p_venta_id uuid,
  p_motivo text,
  p_ip inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text
)
RETURNS ventas
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

  -- Resolver empresa del caller (rechazar inactivo/inexistente explícitamente)
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

  -- Validar pertenencia a empresa
  -- (excepción: superadmin sin empresa activa puede anular ventas de cualquier
  --  empresa al impersonar)
  IF v_usuario_empresa_id IS NOT NULL
     AND v_venta.empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'No tenés permisos para anular esta venta';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'La venta ya está anulada';
  END IF;

  -- ============================================================
  -- NUEVO: validación de factura aprobada activa
  -- ============================================================
  -- Si la venta tiene una factura AFIP aprobada que NO está anulada por
  -- NC, bloquear la anulación. El flujo correcto pasa por emitir NC
  -- primero (server action emitirNotaCreditoAfip) que marca la factura
  -- original como 'anulada_por_nc'. Después de eso, este SELECT no la
  -- encuentra y la anulación procede normal.
  --
  -- Excluimos NC/ND (factura_asociada_id IS NOT NULL) — esas no son
  -- facturas activas, son comprobantes asociados a una factura.
  SELECT COUNT(*) INTO v_factura_activa_count
  FROM public.facturas_afip
  WHERE venta_id = p_venta_id
    AND estado = 'aprobada'
    AND factura_asociada_id IS NULL;

  IF v_factura_activa_count > 0 THEN
    RAISE EXCEPTION 'La venta tiene factura AFIP aprobada activa. Emitir Nota de Crédito antes de anular.';
  END IF;

  -- Si estaba cerrada, revertir stock
  IF v_venta.estado = 'cerrada' THEN
    UPDATE public.variantes v
    SET stock = v.stock + vi.cantidad,
        updated_at = NOW()
    FROM public.venta_items vi, public.productos p
    WHERE vi.venta_id = p_venta_id
      AND vi.variante_id = v.id
      AND v.producto_id = p.id
      AND p.track_stock = true;
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
