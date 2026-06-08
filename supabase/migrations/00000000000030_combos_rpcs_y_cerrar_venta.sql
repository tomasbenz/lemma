-- ============================================================================
-- 00000000000030_combos_rpcs_y_cerrar_venta.sql
-- ----------------------------------------------------------------------------
-- FEATURE COMBOS — Migración C de 3 (última a nivel DB).
--
-- Trae:
--   1. CHECK chk_combo_no_track_stock: un combo SIEMPRE tiene track_stock=false
--      (su stock es derivado de los componentes; con track_stock=true la
--      variante default del combo —stock 0— haría fallar TODA venta de combo
--      en el Loop 1 de cerrar_venta).
--   2. RPC crear_combo / editar_combo (SECURITY DEFINER, es_admin, audit).
--   3. cerrar_venta: cambio ADITIVO. Si el ítem NO es combo → comportamiento
--      idéntico al de migr 006. Si es combo → valida y cascada el stock a los
--      componentes (cantidad_item × cantidad_componente).
--   4. BLINDAJE anti-oversell: TODOS los UPDATE de stock llevan `AND stock >=
--      requerido` + RAISE si no actualizó. Cubre el bug latente de oversell por
--      concurrencia y el caso "combo + su componente suelto en el mismo ticket".
--
-- Adición defensiva: crear_combo exige que cada componente tenga track_stock=true.
-- Si no, el blindaje de la cascada (stock >= requerido sobre una variante con
-- stock 0 no trackeado) volvería el combo invendible. Los combos se arman con
-- productos de stock real.
--
-- IMPORTANTE: NO se aplica automáticamente. Tomás la aplica a mano en prod.
-- Después correr `npm run db:types` antes del commit TS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CHECK: combos sin track_stock
-- ----------------------------------------------------------------------------
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS chk_combo_no_track_stock;
ALTER TABLE public.productos
  ADD CONSTRAINT chk_combo_no_track_stock CHECK (NOT es_combo OR track_stock = false);

-- ----------------------------------------------------------------------------
-- 2) crear_combo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_combo(
  p_usuario_id uuid,
  p_nombre text,
  p_sku_base text,
  p_descuento_pct numeric,
  p_componentes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_nombre text;
  v_sku text;
  v_combo_id uuid;
  v_comp jsonb;
  v_variante_id uuid;
  v_cantidad integer;
  v_comp_producto_id uuid;
  v_comp_empresa uuid;
  v_comp_var_activa boolean;
  v_comp_es_combo boolean;
  v_comp_activo boolean;
  v_comp_track boolean;
  v_count_var integer;
  v_operacion_id uuid;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo admin puede crear combos'; END IF;

  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Usuario sin empresa asignada'; END IF;

  -- ===== Validar nombre + sku =====
  v_nombre := TRIM(COALESCE(p_nombre, ''));
  IF length(v_nombre) < 1 OR length(v_nombre) > 200 THEN
    RAISE EXCEPTION 'El nombre del combo es obligatorio (máx 200 caracteres)';
  END IF;
  v_sku := UPPER(TRIM(COALESCE(p_sku_base, '')));
  IF length(v_sku) < 2 OR length(v_sku) > 30 THEN
    RAISE EXCEPTION 'El SKU debe tener entre 2 y 30 caracteres';
  END IF;
  IF v_sku !~ '^[A-Z0-9][A-Z0-9-]*$' THEN
    RAISE EXCEPTION 'El SKU solo admite letras, números y guiones';
  END IF;
  IF EXISTS (SELECT 1 FROM public.productos WHERE sku_base = v_sku) THEN
    RAISE EXCEPTION 'Ya existe un producto con el SKU %', v_sku;
  END IF;

  -- ===== Validar descuento =====
  IF p_descuento_pct IS NULL OR p_descuento_pct < 0 OR p_descuento_pct > 99 THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 99';
  END IF;

  -- ===== Validar que haya componentes =====
  IF p_componentes IS NULL OR jsonb_typeof(p_componentes) <> 'array'
     OR jsonb_array_length(p_componentes) = 0 THEN
    RAISE EXCEPTION 'El combo debe tener al menos un componente';
  END IF;

  -- ===== Crear producto-combo: es_combo=false inicial, track_stock=false =====
  INSERT INTO public.productos (
    empresa_id, sku_base, nombre, precio_neto, track_stock, activo,
    es_combo, descuento_combo_pct
  ) VALUES (
    v_empresa_id, v_sku, v_nombre, 0, false, true, false, NULL
  )
  RETURNING id INTO v_combo_id;

  -- Variante default del combo.
  INSERT INTO public.variantes (
    empresa_id, producto_id, atributos, sku_variante, stock, activa
  ) VALUES (
    v_empresa_id, v_combo_id, '{}'::jsonb, v_sku || '-DEFAULT', 0, true
  );

  -- Flip a combo (dispara validar_es_combo de Migr A + T1 de Migr B).
  UPDATE public.productos
  SET es_combo = true, descuento_combo_pct = round(p_descuento_pct, 2)
  WHERE id = v_combo_id;

  -- ===== Validar + insertar cada componente (T2 recomputa precio/costo) =====
  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_componentes)
  LOOP
    IF (v_comp->>'variante_id') IS NULL OR (v_comp->>'cantidad') IS NULL THEN
      RAISE EXCEPTION 'Componente inválido (falta variante_id o cantidad)';
    END IF;
    v_variante_id := (v_comp->>'variante_id')::uuid;
    v_cantidad := (v_comp->>'cantidad')::integer;
    IF v_cantidad < 1 THEN
      RAISE EXCEPTION 'La cantidad de cada componente debe ser >= 1';
    END IF;

    SELECT vr.producto_id, vr.empresa_id, vr.activa, p.es_combo, p.activo, p.track_stock
    INTO v_comp_producto_id, v_comp_empresa, v_comp_var_activa,
         v_comp_es_combo, v_comp_activo, v_comp_track
    FROM public.variantes vr
    JOIN public.productos p ON p.id = vr.producto_id
    WHERE vr.id = v_variante_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Componente: variante no encontrada'; END IF;
    IF v_comp_empresa <> v_empresa_id THEN
      RAISE EXCEPTION 'Componente de otra empresa';
    END IF;
    IF NOT v_comp_var_activa THEN RAISE EXCEPTION 'Componente: la variante está inactiva'; END IF;
    IF NOT v_comp_activo THEN RAISE EXCEPTION 'Componente: el producto está inactivo'; END IF;
    IF v_comp_es_combo THEN
      RAISE EXCEPTION 'No se puede anidar combos: un componente no puede ser un combo';
    END IF;
    IF NOT v_comp_track THEN
      RAISE EXCEPTION 'Los componentes de un combo deben controlar stock (track_stock=true)';
    END IF;
    SELECT count(*) INTO v_count_var
    FROM public.variantes WHERE producto_id = v_comp_producto_id AND activa;
    IF v_count_var <> 1 THEN
      RAISE EXCEPTION 'Solo se pueden usar productos con una sola variante como componentes';
    END IF;

    INSERT INTO public.combo_componentes (
      empresa_id, combo_id, componente_variante_id, componente_producto_id, cantidad
    ) VALUES (
      v_empresa_id, v_combo_id, v_variante_id, v_comp_producto_id, v_cantidad
    );
  END LOOP;

  -- ===== Audit =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'crear_combo',
    jsonb_build_object(
      'nombre', v_nombre, 'sku_base', v_sku,
      'descuento_pct', round(p_descuento_pct, 2),
      'componentes', p_componentes
    ),
    1, 1, jsonb_build_array(v_combo_id)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object('ok', true, 'combo_id', v_combo_id, 'operacion_id', v_operacion_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_combo(uuid, text, text, numeric, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.crear_combo(uuid, text, text, numeric, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) editar_combo (scope: descuento + componentes; nombre/sku van por el flow
--    normal de edición de producto)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_combo(
  p_usuario_id uuid,
  p_combo_id uuid,
  p_descuento_pct numeric,
  p_componentes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_combo_empresa uuid;
  v_es_combo boolean;
  v_descuento_anterior numeric;
  v_componentes_antes jsonb;
  v_comp jsonb;
  v_variante_id uuid;
  v_cantidad integer;
  v_comp_producto_id uuid;
  v_comp_empresa uuid;
  v_comp_var_activa boolean;
  v_comp_es_combo boolean;
  v_comp_activo boolean;
  v_comp_track boolean;
  v_count_var integer;
  v_operacion_id uuid;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo admin puede editar combos'; END IF;

  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Usuario sin empresa asignada'; END IF;

  -- ===== Verificar combo =====
  SELECT empresa_id, es_combo, descuento_combo_pct
  INTO v_combo_empresa, v_es_combo, v_descuento_anterior
  FROM public.productos WHERE id = p_combo_id;
  IF NOT FOUND OR v_combo_empresa <> v_empresa_id THEN
    RAISE EXCEPTION 'El combo no existe';
  END IF;
  IF NOT v_es_combo THEN RAISE EXCEPTION 'El producto no es un combo'; END IF;

  -- ===== Validar inputs =====
  IF p_descuento_pct IS NULL OR p_descuento_pct < 0 OR p_descuento_pct > 99 THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 99';
  END IF;
  IF p_componentes IS NULL OR jsonb_typeof(p_componentes) <> 'array'
     OR jsonb_array_length(p_componentes) = 0 THEN
    RAISE EXCEPTION 'El combo debe tener al menos un componente';
  END IF;

  -- ===== Snapshot ANTES (para audit) =====
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('variante_id', componente_variante_id, 'cantidad', cantidad)
           ORDER BY componente_variante_id
         ), '[]'::jsonb)
  INTO v_componentes_antes
  FROM public.combo_componentes WHERE combo_id = p_combo_id;

  -- ===== Reemplazar componentes (T2 recomputa) =====
  DELETE FROM public.combo_componentes WHERE combo_id = p_combo_id;

  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_componentes)
  LOOP
    IF (v_comp->>'variante_id') IS NULL OR (v_comp->>'cantidad') IS NULL THEN
      RAISE EXCEPTION 'Componente inválido (falta variante_id o cantidad)';
    END IF;
    v_variante_id := (v_comp->>'variante_id')::uuid;
    v_cantidad := (v_comp->>'cantidad')::integer;
    IF v_cantidad < 1 THEN
      RAISE EXCEPTION 'La cantidad de cada componente debe ser >= 1';
    END IF;

    SELECT vr.producto_id, vr.empresa_id, vr.activa, p.es_combo, p.activo, p.track_stock
    INTO v_comp_producto_id, v_comp_empresa, v_comp_var_activa,
         v_comp_es_combo, v_comp_activo, v_comp_track
    FROM public.variantes vr
    JOIN public.productos p ON p.id = vr.producto_id
    WHERE vr.id = v_variante_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Componente: variante no encontrada'; END IF;
    IF v_comp_empresa <> v_empresa_id THEN RAISE EXCEPTION 'Componente de otra empresa'; END IF;
    IF NOT v_comp_var_activa THEN RAISE EXCEPTION 'Componente: la variante está inactiva'; END IF;
    IF NOT v_comp_activo THEN RAISE EXCEPTION 'Componente: el producto está inactivo'; END IF;
    IF v_comp_es_combo THEN
      RAISE EXCEPTION 'No se puede anidar combos: un componente no puede ser un combo';
    END IF;
    IF NOT v_comp_track THEN
      RAISE EXCEPTION 'Los componentes de un combo deben controlar stock (track_stock=true)';
    END IF;
    SELECT count(*) INTO v_count_var
    FROM public.variantes WHERE producto_id = v_comp_producto_id AND activa;
    IF v_count_var <> 1 THEN
      RAISE EXCEPTION 'Solo se pueden usar productos con una sola variante como componentes';
    END IF;

    INSERT INTO public.combo_componentes (
      empresa_id, combo_id, componente_variante_id, componente_producto_id, cantidad
    ) VALUES (
      v_empresa_id, p_combo_id, v_variante_id, v_comp_producto_id, v_cantidad
    );
  END LOOP;

  -- ===== Descuento (T1 recomputa con el valor final) =====
  UPDATE public.productos
  SET descuento_combo_pct = round(p_descuento_pct, 2)
  WHERE id = p_combo_id;

  -- ===== Audit =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'editar_combo',
    jsonb_build_object(
      'descuento_anterior', v_descuento_anterior,
      'descuento_nuevo', round(p_descuento_pct, 2),
      'componentes_antes', v_componentes_antes,
      'componentes_despues', p_componentes
    ),
    1, 1, jsonb_build_array(p_combo_id)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object('ok', true, 'combo_id', p_combo_id, 'operacion_id', v_operacion_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.editar_combo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.editar_combo(uuid, uuid, numeric, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) cerrar_venta — ADITIVO (combo: cascada de stock) + BLINDAJE anti-oversell.
--    Reproduce el cuerpo de migr 006; los únicos cambios son:
--      * Loop 1: el SELECT trae p.es_combo + p.id; bloque A valida stock de
--        componentes si es combo.
--      * Loop 2: el decremento de la variante directa se guarda con
--        `IF track_stock` + `AND stock >= cantidad` + RAISE; bloque B cascada
--        a componentes con el mismo blindaje. Flujo no-combo: idéntico.
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
  -- NUEVO (combos)
  v_producto_es_combo boolean;
  v_combo_producto_id uuid;
  v_comp record;
  v_comp_stock integer;
  v_cantidad_item integer;
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
    -- NUEVO: el SELECT trae también es_combo + id del producto.
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
    -- Para combos track_stock=false → este check se saltea (la variante default
    -- del combo no tiene stock real). El stock se valida en el bloque A.
    IF v_producto_track_stock AND v_variante_stock < (v_item->>'cantidad')::integer THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)',
        v_item->>'variante_sku', v_variante_stock, v_item->>'cantidad';
    END IF;

    -- BLOQUE A (NUEVO): validar stock de los componentes si es combo.
    IF v_producto_es_combo THEN
      v_cantidad_item := (v_item->>'cantidad')::integer;
      FOR v_comp IN
        SELECT componente_variante_id, cantidad
        FROM public.combo_componentes
        WHERE combo_id = v_combo_producto_id
        ORDER BY componente_variante_id  -- orden determinístico (anti-deadlock)
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

  -- ===== Loop 2: items + decremento de stock (con blindaje) =====
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
    );

    -- Re-derivar track_stock + es_combo + producto_id para este item.
    SELECT p.track_stock, p.es_combo, p.id
    INTO v_producto_track_stock, v_producto_es_combo, v_combo_producto_id
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.id = (v_item->>'variante_id')::uuid;

    v_cantidad_item := (v_item->>'cantidad')::integer;

    -- Decremento de la variante directa SOLO si el producto trackea stock.
    -- Reemplaza el EXISTS(track_stock=true) original por un IF equivalente +
    -- BLINDAJE `AND stock >= cantidad` + RAISE si no actualizó.
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

    -- BLOQUE B (NUEVO): cascada de stock a los componentes del combo.
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
-- 5) Smoke test
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_funcs integer; v_chk integer;
BEGIN
  SELECT count(*) INTO v_funcs FROM pg_proc
  WHERE proname IN ('crear_combo', 'editar_combo')
    AND pronamespace = 'public'::regnamespace;
  IF v_funcs < 2 THEN
    RAISE EXCEPTION 'Faltan RPCs crear_combo/editar_combo (encontradas: %)', v_funcs;
  END IF;

  SELECT count(*) INTO v_chk FROM pg_constraint
  WHERE conname = 'chk_combo_no_track_stock';
  IF v_chk <> 1 THEN
    RAISE EXCEPTION 'Falta el CHECK chk_combo_no_track_stock';
  END IF;

  RAISE NOTICE 'OK: combos RPCs + cerrar_venta (mig 030) aplicados.';
END;
$$;
