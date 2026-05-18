-- ============================================================
-- MIGRATION: fix modelo de IVA — total a cobrar con recargo
-- Fecha: 2026-05-04
-- ============================================================
--
-- CONTEXTO:
-- El modelo de IVA correcto guarda en ventas.total el monto que el cliente
-- efectivamente paga (con recargo del 10,5% si corresponde), no el neto puro.
--
-- BUG ANTERIOR:
-- Tanto cerrar_venta como finalizar_pedido escribían v_total_neto en
-- ventas.total cuando había recargo, dejando totales inconsistentes
-- (cobrado != registrado).
--
-- ESTA MIGRATION:
-- 1. Reemplaza cerrar_venta con la versión correcta (v_total_a_cobrar)
-- 2. Reemplaza finalizar_pedido con la versión correcta (v_total_a_cobrar)
-- 3. Corrige las ventas legacy con datos persistidos por el bug viejo
-- 4. Verifica al final que no queden inconsistencias
--
-- IDEMPOTENTE: si las funciones ya tienen el fix, los CREATE OR REPLACE
-- solo confirman el estado correcto. El UPDATE solo afecta filas con
-- discrepancia real (clausula WHERE filtra).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. cerrar_venta (idempotente; ya está correcta en producción
--    pero la incluimos para que la migration sea reproducible
--    en ambientes nuevos)
-- ============================================================

CREATE OR REPLACE FUNCTION public.cerrar_venta(
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_canal text DEFAULT 'mostrador'::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_medios_pago jsonb DEFAULT '[]'::jsonb,
  p_descuento_total numeric DEFAULT 0,
  p_tipo_factura tipo_factura DEFAULT 'sin_factura'::tipo_factura,
  p_monto_facturado numeric DEFAULT 0,
  p_nota_interna text DEFAULT NULL::text,
  p_nombre_cliente_custom text DEFAULT NULL::text,
  p_recargo_iva_reducido boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venta_id uuid;
  v_venta_numero bigint;
  v_subtotal numeric := 0;
  v_total_neto numeric := 0;
  v_total_a_cobrar numeric := 0;
  v_total_medios numeric := 0;
  v_item jsonb;
  v_medio jsonb;
  v_variante_stock integer;
  v_variante_activa boolean;
  v_producto_track_stock boolean;
  v_empresa_id uuid;
  v_nombre_custom_clean text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un item';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    PERFORM 1 FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no pertenece a la empresa del usuario';
    END IF;
  END IF;

  v_nombre_custom_clean := NULLIF(TRIM(COALESCE(p_nombre_cliente_custom, '')), '');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT v.stock, v.activa, p.track_stock
    INTO v_variante_stock, v_variante_activa, v_producto_track_stock
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.id = (v_item->>'variante_id')::uuid
      AND v.empresa_id = v_empresa_id
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante % no encontrada o no pertenece a la empresa',
        v_item->>'variante_id';
    END IF;
    IF NOT v_variante_activa THEN
      RAISE EXCEPTION 'La variante % está inactiva', v_item->>'variante_id';
    END IF;
    IF v_producto_track_stock AND v_variante_stock < (v_item->>'cantidad')::integer THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)',
        v_item->>'variante_sku', v_variante_stock, v_item->>'cantidad';
    END IF;

    v_subtotal := v_subtotal + (v_item->>'subtotal_neto')::numeric;
  END LOOP;

  v_total_neto := v_subtotal - p_descuento_total;
  IF v_total_neto < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser mayor que el subtotal';
  END IF;

  IF p_recargo_iva_reducido THEN
    IF p_tipo_factura = 'sin_factura' THEN
      RAISE EXCEPTION 'No se puede aplicar recargo del 10,5%% sin emitir factura';
    END IF;
    IF abs(p_monto_facturado - round(v_total_neto * 1.105, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Con recargo del 10,5%%, el monto facturado debe igualar al total cobrado (%, esperado %)',
        p_monto_facturado, round(v_total_neto * 1.105, 2);
    END IF;
  END IF;

  IF p_recargo_iva_reducido THEN
    v_total_a_cobrar := round(v_total_neto * 1.105, 2);
  ELSE
    v_total_a_cobrar := v_total_neto;
  END IF;

  FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios_pago)
  LOOP
    v_total_medios := v_total_medios + (v_medio->>'monto')::numeric;
  END LOOP;

  IF abs(v_total_medios - v_total_a_cobrar) > 0.02 THEN
    RAISE EXCEPTION 'La suma de medios de pago (%) no coincide con el total a cobrar (%)',
      v_total_medios, v_total_a_cobrar;
  END IF;

  IF p_tipo_factura <> 'sin_factura' THEN
    IF p_monto_facturado <= 0 THEN
      RAISE EXCEPTION 'El monto facturado debe ser mayor a cero';
    END IF;
    IF p_monto_facturado > v_total_a_cobrar + 0.02 THEN
      RAISE EXCEPTION 'El monto facturado (%) no puede ser mayor al total a cobrar (%)',
        p_monto_facturado, v_total_a_cobrar;
    END IF;
  END IF;

  -- FIX MODELO IVA: guardar v_total_a_cobrar (con recargo si aplica),
  -- no v_total_neto.
  INSERT INTO public.ventas (
    canal, usuario_id, cliente_id,
    subtotal_neto, descuento_total, total,
    estado, tipo_factura, monto_facturado,
    nota_interna, closed_at, empresa_id,
    nombre_cliente_custom,
    recargo_iva_reducido
  ) VALUES (
    p_canal::canal_venta, p_usuario_id, p_cliente_id,
    v_subtotal, p_descuento_total, v_total_a_cobrar,
    'cerrada'::venta_estado, p_tipo_factura, p_monto_facturado,
    p_nota_interna, NOW(), v_empresa_id,
    v_nombre_custom_clean,
    p_recargo_iva_reducido
  )
  RETURNING id, numero INTO v_venta_id, v_venta_numero;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.items_venta (
      venta_id, variante_id,
      producto_nombre, producto_sku, variante_sku,
      variante_color, variante_talle,
      cantidad, precio_unitario_neto, subtotal_neto,
      empresa_id
    ) VALUES (
      v_venta_id, (v_item->>'variante_id')::uuid,
      v_item->>'producto_nombre', v_item->>'producto_sku', v_item->>'variante_sku',
      v_item->>'variante_color', v_item->>'variante_talle',
      (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario_neto')::numeric,
      (v_item->>'subtotal_neto')::numeric,
      v_empresa_id
    );

    UPDATE public.variantes
    SET stock = stock - (v_item->>'cantidad')::integer
    WHERE id = (v_item->>'variante_id')::uuid
      AND empresa_id = v_empresa_id
      AND EXISTS (
        SELECT 1 FROM public.productos
        WHERE id = variantes.producto_id AND track_stock = true
      );
  END LOOP;

  FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios_pago)
  LOOP
    INSERT INTO public.medios_pago_venta (
      venta_id, medio, monto, referencia, empresa_id
    ) VALUES (
      v_venta_id,
      (v_medio->>'medio')::medio_pago,
      (v_medio->>'monto')::numeric,
      v_medio->>'referencia',
      v_empresa_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'numero', v_venta_numero,
    'total', v_total_a_cobrar,
    'total_cobrado', v_total_a_cobrar
  );
END;
$function$;


-- ============================================================
-- 2. finalizar_pedido (FIX CRÍTICO: estaba escribiendo v_total_neto
--    en lugar de v_total_a_cobrar)
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalizar_pedido(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_medios_pago jsonb,
  p_descuento_total numeric DEFAULT 0,
  p_tipo_factura tipo_factura DEFAULT 'sin_factura'::tipo_factura,
  p_monto_facturado numeric DEFAULT 0,
  p_nota_interna text DEFAULT NULL::text,
  p_recargo_iva_reducido boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_estado_actual venta_estado;
  v_subtotal numeric;
  v_total_neto numeric;
  v_total_a_cobrar numeric;
  v_total_medios numeric := 0;
  v_item record;
  v_medio jsonb;
  v_variante_stock integer;
  v_variante_activa boolean;
  v_producto_track_stock boolean;
  v_venta_numero bigint;
  v_empresa_id uuid;
  v_pedido_empresa_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  SELECT estado, subtotal_neto, numero, empresa_id
  INTO v_estado_actual, v_subtotal, v_venta_numero, v_pedido_empresa_id
  FROM public.ventas
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no encontrado', p_pedido_id;
  END IF;

  IF v_pedido_empresa_id <> v_empresa_id THEN
    RAISE EXCEPTION 'El pedido no pertenece a la empresa del usuario';
  END IF;

  IF v_estado_actual <> 'guardada'::venta_estado THEN
    RAISE EXCEPTION 'El pedido no está en estado guardada (estado actual: %)', v_estado_actual;
  END IF;

  FOR v_item IN
    SELECT iv.variante_id, iv.cantidad, iv.variante_sku
    FROM public.items_venta iv
    WHERE iv.venta_id = p_pedido_id
  LOOP
    SELECT v.stock, v.activa, p.track_stock
    INTO v_variante_stock, v_variante_activa, v_producto_track_stock
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.id = v_item.variante_id
      AND v.empresa_id = v_empresa_id
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante % no encontrada o no pertenece a la empresa', v_item.variante_sku;
    END IF;

    IF NOT v_variante_activa THEN
      RAISE EXCEPTION 'La variante % ya no está activa', v_item.variante_sku;
    END IF;
    IF v_producto_track_stock AND v_variante_stock < v_item.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)',
        v_item.variante_sku, v_variante_stock, v_item.cantidad;
    END IF;
  END LOOP;

  v_total_neto := v_subtotal - p_descuento_total;
  IF v_total_neto < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser mayor que el subtotal';
  END IF;

  IF p_recargo_iva_reducido THEN
    IF p_tipo_factura = 'sin_factura' THEN
      RAISE EXCEPTION 'No se puede aplicar recargo del 10,5%% sin emitir factura';
    END IF;
    IF abs(p_monto_facturado - round(v_total_neto * 1.105, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Con recargo del 10,5%%, el monto facturado debe igualar al total cobrado (%, esperado %)',
        p_monto_facturado, round(v_total_neto * 1.105, 2);
    END IF;
  END IF;

  IF p_recargo_iva_reducido THEN
    v_total_a_cobrar := round(v_total_neto * 1.105, 2);
  ELSE
    v_total_a_cobrar := v_total_neto;
  END IF;

  FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios_pago)
  LOOP
    v_total_medios := v_total_medios + (v_medio->>'monto')::numeric;
  END LOOP;

  IF abs(v_total_medios - v_total_a_cobrar) > 0.02 THEN
    RAISE EXCEPTION 'La suma de medios de pago (%) no coincide con el total a cobrar (%)',
      v_total_medios, v_total_a_cobrar;
  END IF;

  IF p_tipo_factura <> 'sin_factura' THEN
    IF p_monto_facturado <= 0 THEN
      RAISE EXCEPTION 'El monto facturado debe ser mayor a cero';
    END IF;
    IF p_monto_facturado > v_total_a_cobrar + 0.02 THEN
      RAISE EXCEPTION 'El monto facturado (%) no puede ser mayor al total a cobrar (%)',
        p_monto_facturado, v_total_a_cobrar;
    END IF;
  END IF;

  -- FIX MODELO IVA: guardar v_total_a_cobrar (con recargo si aplica),
  -- no v_total_neto.
  UPDATE public.ventas
  SET
    descuento_total = p_descuento_total,
    total = v_total_a_cobrar,
    estado = 'cerrada'::venta_estado,
    tipo_factura = p_tipo_factura,
    monto_facturado = p_monto_facturado,
    nota_interna = COALESCE(p_nota_interna, nota_interna),
    closed_at = NOW(),
    recargo_iva_reducido = p_recargo_iva_reducido
  WHERE id = p_pedido_id
    AND empresa_id = v_empresa_id;

  -- Descontar stock
  FOR v_item IN
    SELECT iv.variante_id, iv.cantidad
    FROM public.items_venta iv
    WHERE iv.venta_id = p_pedido_id
  LOOP
    UPDATE public.variantes
    SET stock = stock - v_item.cantidad
    WHERE id = v_item.variante_id
      AND empresa_id = v_empresa_id
      AND EXISTS (
        SELECT 1 FROM public.productos
        WHERE id = variantes.producto_id AND track_stock = true
      );
  END LOOP;

  -- Medios de pago: guardar montos finales tal como vienen
  FOR v_medio IN SELECT * FROM jsonb_array_elements(p_medios_pago)
  LOOP
    INSERT INTO public.medios_pago_venta (
      venta_id, medio, monto, referencia, empresa_id
    )
    VALUES (
      p_pedido_id,
      (v_medio->>'medio')::medio_pago,
      (v_medio->>'monto')::numeric,
      v_medio->>'referencia',
      v_empresa_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', p_pedido_id,
    'numero', v_venta_numero,
    'total', v_total_a_cobrar,
    'total_cobrado', v_total_a_cobrar
  );
END;
$function$;


-- ============================================================
-- 3. UPDATE de ventas legacy con totales mal calculados
-- ============================================================
-- Solo afecta ventas con recargo activo y total != (subtotal - descuento) * 1.105.
-- En el momento de aplicar la migration: 1 fila (venta #45).
UPDATE public.ventas
SET
  total = round((subtotal_neto - descuento_total) * 1.105, 2),
  updated_at = NOW()
WHERE recargo_iva_reducido = true
  AND estado != 'anulada'
  AND abs(total - round((subtotal_neto - descuento_total) * 1.105, 2)) > 0.02;


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRATION
-- ============================================================

-- Confirmar que no quedan ventas con totales inconsistentes
SELECT
  count(*) AS ventas_con_recargo,
  count(*) FILTER (
    WHERE abs(total - round((subtotal_neto - descuento_total) * 1.105, 2)) > 0.02
  ) AS aun_inconsistentes
FROM ventas
WHERE recargo_iva_reducido = true
  AND estado != 'anulada';

-- Esperado: aun_inconsistentes = 0
