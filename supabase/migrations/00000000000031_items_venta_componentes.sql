-- ============================================================================
-- 00000000000031_items_venta_componentes.sql
-- ----------------------------------------------------------------------------
-- FEATURE COMBOS — Migración D1 (de 2): snapshot de consumo + cascada en
-- finalizar_pedido.
--
-- Decisión Opción 1: snapshotear lo REALMENTE consumido al vender un combo en
-- la tabla items_venta_componentes. Permite reverts exactos en editar/anular
-- aunque la receta del combo cambie después de la venta.
--
-- Esta migración (D1) cubre el camino "registrar consumo al vender":
--   1. Tabla items_venta_componentes.
--   2. cerrar_venta: además de cascadear, INSERT del snapshot por combo.
--   3. finalizar_pedido: bloque A (validación componentes) + bloque B (cascada
--      con blindaje) + snapshot. CIERRA EL AGUJERO CRÍTICO del flujo
--      vendedora → guardar pedido → finalizar (oversell de componentes).
--
-- La Migración D2 (032) cubre el camino "revertir con snapshot":
--   editar_venta + anular_venta.
--
-- Ambas van ANTES de cualquier UI que permita vender/guardar combos → no hay
-- pedidos huérfanos con combos en el ínterin.
--
-- IMPORTANTE: NO se aplica automáticamente. Tomás la aplica a mano + db:types.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla items_venta_componentes (snapshot del consumo)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items_venta_componentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  item_venta_id uuid NOT NULL REFERENCES public.items_venta(id) ON DELETE CASCADE,
  componente_variante_id uuid NOT NULL REFERENCES public.variantes(id) ON DELETE RESTRICT,
  cantidad_consumida integer NOT NULL CHECK (cantidad_consumida > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_venta_componentes_item_idx
  ON public.items_venta_componentes(item_venta_id);
CREATE INDEX IF NOT EXISTS items_venta_componentes_empresa_variante_idx
  ON public.items_venta_componentes(empresa_id, componente_variante_id);

ALTER TABLE public.items_venta_componentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_venta_componentes_select ON public.items_venta_componentes;
CREATE POLICY items_venta_componentes_select ON public.items_venta_componentes FOR SELECT
  USING (es_superadmin() OR empresa_id = get_empresa_id());

DROP POLICY IF EXISTS items_venta_componentes_write ON public.items_venta_componentes;
CREATE POLICY items_venta_componentes_write ON public.items_venta_componentes FOR ALL
  USING (empresa_id = get_empresa_id())
  WITH CHECK (empresa_id = get_empresa_id());

-- ----------------------------------------------------------------------------
-- 2) cerrar_venta — igual que mig 030 + captura del item_venta_id + snapshot.
-- ----------------------------------------------------------------------------
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
  p_recargo_factura_completa boolean DEFAULT false,
  p_recargo_porcentaje_manual numeric DEFAULT NULL::numeric,
  p_recargo_motivo text DEFAULT NULL::text
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
  v_recargo_motivo_clean text;
  v_caja_id uuid;
  v_sucursal_id uuid;
  v_turno_id uuid;
  v_producto_es_combo boolean;
  v_combo_producto_id uuid;
  v_comp record;
  v_comp_stock integer;
  v_cantidad_item integer;
  v_item_venta_id uuid;  -- NUEVO D1: para el snapshot de consumo
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

  IF p_recargo_factura_completa AND p_recargo_porcentaje_manual IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden aplicar ambos recargos (10,5%% factura completa Y recargo manual) en la misma venta';
  END IF;

  IF p_recargo_porcentaje_manual IS NOT NULL THEN
    IF p_recargo_porcentaje_manual < 0 OR p_recargo_porcentaje_manual > 100 THEN
      RAISE EXCEPTION 'El recargo manual debe estar entre 0 y 100 (recibido: %)',
        p_recargo_porcentaje_manual;
    END IF;
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Usuario sin empresa asignada'; END IF;

  IF p_cliente_id IS NOT NULL THEN
    PERFORM 1 FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no pertenece a la empresa del usuario';
    END IF;
  END IF;

  v_nombre_custom_clean := NULLIF(TRIM(COALESCE(p_nombre_cliente_custom, '')), '');
  v_recargo_motivo_clean := NULLIF(TRIM(COALESCE(p_recargo_motivo, '')), '');

  v_caja_id := public.get_default_caja_id(v_empresa_id);
  IF v_caja_id IS NULL THEN
    RAISE EXCEPTION 'No hay caja configurada para la empresa';
  END IF;

  SELECT sucursal_id INTO v_sucursal_id
  FROM public.cajas WHERE id = v_caja_id;

  SELECT id INTO v_turno_id
  FROM public.turnos_caja
  WHERE caja_id = v_caja_id AND cerrado_at IS NULL
  LIMIT 1;

  IF v_turno_id IS NULL THEN
    RAISE EXCEPTION 'No hay turno de caja abierto. Abrí un turno antes de vender.';
  END IF;

  -- ===== Loop 1: validación =====
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT v.stock, v.activa, p.track_stock, p.es_combo, p.id
    INTO v_variante_stock, v_variante_activa, v_producto_track_stock,
         v_producto_es_combo, v_combo_producto_id
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

    -- BLOQUE A: validar stock de los componentes si es combo.
    IF v_producto_es_combo THEN
      v_cantidad_item := (v_item->>'cantidad')::integer;
      FOR v_comp IN
        SELECT componente_variante_id, cantidad
        FROM public.combo_componentes
        WHERE combo_id = v_combo_producto_id
        ORDER BY componente_variante_id
      LOOP
        SELECT stock INTO v_comp_stock
        FROM public.variantes
        WHERE id = v_comp.componente_variante_id AND empresa_id = v_empresa_id
        FOR UPDATE;
        IF v_comp_stock < (v_cantidad_item * v_comp.cantidad) THEN
          RAISE EXCEPTION 'Stock insuficiente para un componente del combo %',
            v_item->>'variante_sku';
        END IF;
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + (v_item->>'subtotal_neto')::numeric;
  END LOOP;

  v_total_neto := v_subtotal - p_descuento_total;
  IF v_total_neto < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser mayor que el subtotal';
  END IF;

  IF p_recargo_factura_completa THEN
    IF p_tipo_factura = 'sin_factura' THEN
      RAISE EXCEPTION 'No se puede aplicar recargo del 10,5%% sin emitir factura';
    END IF;
    IF abs(p_monto_facturado - round(v_total_neto * 1.105, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Con recargo del 10,5%%, el monto facturado debe igualar al total cobrado (%, esperado %)',
        p_monto_facturado, round(v_total_neto * 1.105, 2);
    END IF;
  END IF;

  IF p_recargo_factura_completa THEN
    v_total_a_cobrar := round(v_total_neto * 1.105, 2);
  ELSIF p_recargo_porcentaje_manual IS NOT NULL THEN
    v_total_a_cobrar := round(v_total_neto * (1 + p_recargo_porcentaje_manual / 100.0), 2);
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

  INSERT INTO public.ventas (
    canal, usuario_id, cliente_id,
    subtotal_neto, descuento_total, total,
    estado, tipo_factura, monto_facturado,
    nota_interna, closed_at, empresa_id,
    nombre_cliente_custom,
    recargo_factura_completa,
    recargo_porcentaje_manual,
    recargo_motivo,
    caja_id, sucursal_id, turno_id
  ) VALUES (
    p_canal::canal_venta, p_usuario_id, p_cliente_id,
    v_subtotal, p_descuento_total, v_total_a_cobrar,
    'cerrada'::venta_estado, p_tipo_factura, p_monto_facturado,
    p_nota_interna, NOW(), v_empresa_id,
    v_nombre_custom_clean,
    p_recargo_factura_completa,
    p_recargo_porcentaje_manual,
    v_recargo_motivo_clean,
    v_caja_id, v_sucursal_id, v_turno_id
  )
  RETURNING id, numero INTO v_venta_id, v_venta_numero;

  -- ===== Loop 2: items + decremento de stock (con blindaje) + snapshot =====
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.items_venta (
      venta_id, variante_id,
      producto_nombre, producto_sku, variante_sku,
      variante_atributos,
      cantidad, precio_unitario_neto, subtotal_neto,
      empresa_id
    ) VALUES (
      v_venta_id, (v_item->>'variante_id')::uuid,
      v_item->>'producto_nombre', v_item->>'producto_sku', v_item->>'variante_sku',
      COALESCE(v_item->'variante_atributos', '{}'::jsonb),
      (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario_neto')::numeric,
      (v_item->>'subtotal_neto')::numeric,
      v_empresa_id
    )
    RETURNING id INTO v_item_venta_id;  -- NUEVO D1

    SELECT p.track_stock, p.es_combo, p.id
    INTO v_producto_track_stock, v_producto_es_combo, v_combo_producto_id
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.id = (v_item->>'variante_id')::uuid;

    v_cantidad_item := (v_item->>'cantidad')::integer;

    IF v_producto_track_stock THEN
      UPDATE public.variantes
      SET stock = stock - v_cantidad_item
      WHERE id = (v_item->>'variante_id')::uuid
        AND empresa_id = v_empresa_id
        AND stock >= v_cantidad_item;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente en variante % (oversell prevenido)',
          v_item->>'variante_sku';
      END IF;
    END IF;

    -- BLOQUE B: cascada de stock a los componentes del combo + SNAPSHOT.
    IF v_producto_es_combo THEN
      FOR v_comp IN
        SELECT componente_variante_id, cantidad
        FROM public.combo_componentes
        WHERE combo_id = v_combo_producto_id
        ORDER BY componente_variante_id
      LOOP
        UPDATE public.variantes
        SET stock = stock - (v_cantidad_item * v_comp.cantidad)
        WHERE id = v_comp.componente_variante_id
          AND empresa_id = v_empresa_id
          AND stock >= (v_cantidad_item * v_comp.cantidad);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stock insuficiente para componente del combo % (oversell prevenido en cascada)',
            v_item->>'variante_sku';
        END IF;

        INSERT INTO public.items_venta_componentes (
          empresa_id, item_venta_id, componente_variante_id, cantidad_consumida
        ) VALUES (
          v_empresa_id, v_item_venta_id, v_comp.componente_variante_id,
          v_cantidad_item * v_comp.cantidad
        );
      END LOOP;
    END IF;
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
    'total_cobrado', v_total_a_cobrar,
    'turno_id', v_turno_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerrar_venta(
  uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric,
  text, text, boolean, numeric, text
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cerrar_venta(
  uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric,
  text, text, boolean, numeric, text
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) finalizar_pedido — cuerpo de mig 003 + bloque A + bloque B + snapshot.
--    Los items vienen de items_venta (el pedido ya existe como 'guardada').
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_pedido(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_medios_pago jsonb,
  p_descuento_total numeric DEFAULT 0,
  p_tipo_factura tipo_factura DEFAULT 'sin_factura'::tipo_factura,
  p_monto_facturado numeric DEFAULT 0,
  p_nota_interna text DEFAULT NULL::text,
  p_recargo_factura_completa boolean DEFAULT false,
  p_recargo_porcentaje_manual numeric DEFAULT NULL::numeric,
  p_recargo_motivo text DEFAULT NULL::text
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
  v_recargo_motivo_clean text;
  -- NUEVO (combos)
  v_producto_es_combo boolean;
  v_combo_producto_id uuid;
  v_comp record;
  v_comp_stock integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;

  IF p_recargo_factura_completa AND p_recargo_porcentaje_manual IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden aplicar ambos recargos (10,5%% factura completa Y recargo manual) en la misma venta';
  END IF;

  IF p_recargo_porcentaje_manual IS NOT NULL THEN
    IF p_recargo_porcentaje_manual < 0 OR p_recargo_porcentaje_manual > 100 THEN
      RAISE EXCEPTION 'El recargo manual debe estar entre 0 y 100 (recibido: %)', p_recargo_porcentaje_manual;
    END IF;
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

  v_recargo_motivo_clean := NULLIF(TRIM(COALESCE(p_recargo_motivo, '')), '');

  -- ===== Loop 1: validación (incluye bloque A para combos) =====
  FOR v_item IN
    SELECT iv.id AS item_venta_id, iv.variante_id, iv.cantidad, iv.variante_sku
    FROM public.items_venta iv
    WHERE iv.venta_id = p_pedido_id
  LOOP
    SELECT v.stock, v.activa, p.track_stock, p.es_combo, p.id
    INTO v_variante_stock, v_variante_activa, v_producto_track_stock,
         v_producto_es_combo, v_combo_producto_id
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

    -- BLOQUE A: validar stock de los componentes si es combo.
    IF v_producto_es_combo THEN
      FOR v_comp IN
        SELECT componente_variante_id, cantidad
        FROM public.combo_componentes
        WHERE combo_id = v_combo_producto_id
        ORDER BY componente_variante_id
      LOOP
        SELECT stock INTO v_comp_stock
        FROM public.variantes
        WHERE id = v_comp.componente_variante_id AND empresa_id = v_empresa_id
        FOR UPDATE;
        IF v_comp_stock < (v_item.cantidad * v_comp.cantidad) THEN
          RAISE EXCEPTION 'Stock insuficiente para un componente del combo %', v_item.variante_sku;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  v_total_neto := v_subtotal - p_descuento_total;
  IF v_total_neto < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser mayor que el subtotal';
  END IF;

  IF p_recargo_factura_completa THEN
    IF p_tipo_factura = 'sin_factura' THEN
      RAISE EXCEPTION 'No se puede aplicar recargo del 10,5%% sin emitir factura';
    END IF;
    IF abs(p_monto_facturado - round(v_total_neto * 1.105, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Con recargo del 10,5%%, el monto facturado debe igualar al total cobrado (%, esperado %)',
        p_monto_facturado, round(v_total_neto * 1.105, 2);
    END IF;
  END IF;

  IF p_recargo_factura_completa THEN
    v_total_a_cobrar := round(v_total_neto * 1.105, 2);
  ELSIF p_recargo_porcentaje_manual IS NOT NULL THEN
    v_total_a_cobrar := round(v_total_neto * (1 + p_recargo_porcentaje_manual / 100.0), 2);
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

  UPDATE public.ventas
  SET
    descuento_total = p_descuento_total,
    total = v_total_a_cobrar,
    estado = 'cerrada'::venta_estado,
    tipo_factura = p_tipo_factura,
    monto_facturado = p_monto_facturado,
    nota_interna = COALESCE(p_nota_interna, nota_interna),
    closed_at = NOW(),
    recargo_factura_completa = p_recargo_factura_completa,
    recargo_porcentaje_manual = p_recargo_porcentaje_manual,
    recargo_motivo = v_recargo_motivo_clean
  WHERE id = p_pedido_id
    AND empresa_id = v_empresa_id;

  -- ===== Loop 2: decremento de stock (con blindaje) + bloque B + snapshot =====
  FOR v_item IN
    SELECT iv.id AS item_venta_id, iv.variante_id, iv.cantidad, iv.variante_sku
    FROM public.items_venta iv
    WHERE iv.venta_id = p_pedido_id
  LOOP
    SELECT p.track_stock, p.es_combo, p.id
    INTO v_producto_track_stock, v_producto_es_combo, v_combo_producto_id
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.id = v_item.variante_id;

    IF v_producto_track_stock THEN
      UPDATE public.variantes
      SET stock = stock - v_item.cantidad
      WHERE id = v_item.variante_id
        AND empresa_id = v_empresa_id
        AND stock >= v_item.cantidad;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente en variante % (oversell prevenido)', v_item.variante_sku;
      END IF;
    END IF;

    IF v_producto_es_combo THEN
      FOR v_comp IN
        SELECT componente_variante_id, cantidad
        FROM public.combo_componentes
        WHERE combo_id = v_combo_producto_id
        ORDER BY componente_variante_id
      LOOP
        UPDATE public.variantes
        SET stock = stock - (v_item.cantidad * v_comp.cantidad)
        WHERE id = v_comp.componente_variante_id
          AND empresa_id = v_empresa_id
          AND stock >= (v_item.cantidad * v_comp.cantidad);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stock insuficiente para componente del combo % (oversell prevenido en cascada)', v_item.variante_sku;
        END IF;

        INSERT INTO public.items_venta_componentes (
          empresa_id, item_venta_id, componente_variante_id, cantidad_consumida
        ) VALUES (
          v_empresa_id, v_item.item_venta_id, v_comp.componente_variante_id,
          v_item.cantidad * v_comp.cantidad
        );
      END LOOP;
    END IF;
  END LOOP;

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

REVOKE EXECUTE ON FUNCTION public.finalizar_pedido(
  uuid, uuid, jsonb, numeric, tipo_factura, numeric, text, boolean, numeric, text
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.finalizar_pedido(
  uuid, uuid, jsonb, numeric, tipo_factura, numeric, text, boolean, numeric, text
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) Smoke test
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_tabla integer;
BEGIN
  SELECT count(*) INTO v_tabla FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'items_venta_componentes';
  IF v_tabla <> 1 THEN
    RAISE EXCEPTION 'No se creó la tabla items_venta_componentes';
  END IF;
  RAISE NOTICE 'OK: items_venta_componentes + cerrar_venta/finalizar_pedido con snapshot (mig 031) aplicados.';
END;
$$;
