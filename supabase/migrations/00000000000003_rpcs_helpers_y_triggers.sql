-- ============================================================================
-- Lemma — RPCs reales, helpers y triggers portados desde Loom Point
-- ============================================================================
--
-- Reemplaza los STUBS de RPCs del 00000000000000_init_lemma.sql con la
-- implementación real extraída del Supabase de Loom Point
-- (project mxkelleuppbdghmokcur), aplicando dos adaptaciones puntuales
-- al schema generalizado de Lemma:
--
--   ADAPTACIÓN A — INSERT en items_venta:
--     Loom Point tenía columnas (variante_color text, variante_talle text).
--     Lemma las generaliza a (variante_atributos jsonb). Donde la función
--     original hacía:
--         variante_color, variante_talle
--         VALUES (..., v_item->>'variante_color', v_item->>'variante_talle', ...)
--     Lemma usa:
--         variante_atributos
--         VALUES (..., COALESCE(v_item->'variante_atributos', '{}'::jsonb), ...)
--
--   ADAPTACIÓN B — INSERT en variantes (solo en importar_productos_bulk):
--     Loom Point insertaba la variante DEFAULT con (color, talle, ...) = (NULL, NULL, ...).
--     Lemma usa (atributos, ...) = ('{}'::jsonb, ...).
--
-- Funciones excluidas explícitamente (NO portar):
--   * buscar_o_crear_color, buscar_o_crear_talle — las tablas catalogo_colores
--     y catalogo_talles no existen en Lemma.
--   * Funciones de pg_trgm (similarity, set_limit, gtrgm_*, etc.) — provienen
--     de la extensión, no son código nuestro.
--   * Overload viejo de ventas_totales_filtrados sin p_busqueda_texto —
--     deuda técnica que no se arrastra.
--
-- Por qué DROP previo: las stubs del init definen algunas firmas que no
-- matchean las reales (cerrar_venta/finalizar_pedido con orden distinto de
-- args, anular_venta con p_ip text → inet y RETURNS jsonb → ventas,
-- es_superadmin(uuid) → es_superadmin(), current_empresa_id() → get_empresa_id()).
-- CREATE OR REPLACE rechaza el cambio de firma; necesitamos DROP previo.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ALTER TABLE: agregar columna que registrar_login necesita
-- ----------------------------------------------------------------------------

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS ultimo_login_user_agent text;

-- ============================================================================
-- BLOQUE 0 — DROP POLICIES que dependen de las funciones helper viejas
-- ============================================================================
-- Las policies del init y de sucursales_cajas referencian
-- es_superadmin(auth.uid()) y current_empresa_id(). Como reemplazamos esas
-- funciones por las reales (es_superadmin() sin args, get_empresa_id()), hay
-- que dropear las policies primero para poder dropear las funciones.

DROP POLICY IF EXISTS empresas_select ON public.empresas;
DROP POLICY IF EXISTS usuarios_select ON public.usuarios;
DROP POLICY IF EXISTS configuracion_select ON public.configuracion;
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
DROP POLICY IF EXISTS catalogo_categorias_select ON public.catalogo_categorias;
DROP POLICY IF EXISTS catalogo_categorias_write ON public.catalogo_categorias;
DROP POLICY IF EXISTS categoria_atributos_select ON public.categoria_atributos;
DROP POLICY IF EXISTS categoria_atributos_write ON public.categoria_atributos;
DROP POLICY IF EXISTS clientes_select ON public.clientes;
DROP POLICY IF EXISTS clientes_write ON public.clientes;
DROP POLICY IF EXISTS productos_select ON public.productos;
DROP POLICY IF EXISTS productos_write ON public.productos;
DROP POLICY IF EXISTS variantes_select ON public.variantes;
DROP POLICY IF EXISTS variantes_write ON public.variantes;
DROP POLICY IF EXISTS ventas_select ON public.ventas;
DROP POLICY IF EXISTS items_venta_select ON public.items_venta;
DROP POLICY IF EXISTS medios_pago_venta_select ON public.medios_pago_venta;
DROP POLICY IF EXISTS pagos_select ON public.pagos;
DROP POLICY IF EXISTS facturas_select ON public.facturas;
DROP POLICY IF EXISTS facturas_afip_select ON public.facturas_afip;
DROP POLICY IF EXISTS sucursales_select ON public.sucursales;
DROP POLICY IF EXISTS sucursales_write ON public.sucursales;
DROP POLICY IF EXISTS cajas_select ON public.cajas;
DROP POLICY IF EXISTS cajas_write ON public.cajas;

-- ============================================================================
-- BLOQUE 0 — DROP FUNCTIONS viejas (stubs + helpers con firma vieja)
-- ============================================================================

-- Helpers del init con firma distinta a la real
DROP FUNCTION IF EXISTS public.es_superadmin(uuid);
DROP FUNCTION IF EXISTS public.current_empresa_id();

-- Stubs RPCs con firma distinta (cerrar_venta, finalizar_pedido, anular_venta)
DROP FUNCTION IF EXISTS public.cerrar_venta(uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric, text, text, boolean, text, numeric);
DROP FUNCTION IF EXISTS public.finalizar_pedido(uuid, uuid, jsonb, numeric, tipo_factura, numeric, text, boolean, text, numeric);
DROP FUNCTION IF EXISTS public.anular_venta(uuid, text, text, text);

-- Stubs RPCs con firma matching (drop por prolijidad, después CREATE limpio)
DROP FUNCTION IF EXISTS public.guardar_pedido(uuid, uuid, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.editar_pedido(uuid, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.editar_venta(uuid, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.ajustar_stock(uuid, integer, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.persistir_cae_y_marcar_emitida(uuid, uuid, uuid, text, date, bigint, jsonb, bigint);
DROP FUNCTION IF EXISTS public.importar_productos_bulk(uuid, jsonb);

-- ============================================================================
-- BLOQUE 1 — Helpers de identidad y permisos (Loom Point real)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalizar_nombre(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  select trim(lower(
    translate(
      coalesce(texto, ''),
      'áéíóúÁÉÍÓÚñÑ',
      'aeiouAEIOUnN'
    )
  ));
$function$;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid()
      AND rol = ANY(ARRAY['admin'::user_role, 'superadmin'::user_role])
      AND activo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_admin_estricto()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid()
      and rol = 'admin'
      and activo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.es_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid()
      AND rol = 'superadmin'::user_role
      AND activo = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_empresa_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.usuarios WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.get_rol_usuario()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT rol::text
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select rol from public.usuarios where id = auth.uid() and activo = true;
$function$;

-- ============================================================================
-- BLOQUE 2 — Triggers de utilidad
-- ============================================================================
-- set_updated_at() ya existe (creada en init) con cuerpo equivalente.
-- CREATE OR REPLACE actualiza al cuerpo del dump real (SQL es case-insensitive
-- en identificadores, no hay cambio semántico).

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  raise exception 'El audit log es inmutable. No se permiten UPDATE ni DELETE.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_puntos_venta()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if exists (select 1 from unnest(new.puntos_venta) p where p < 1 or p > 99999) then
    raise exception 'Cada punto de venta debe estar entre 1 y 99999';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nombre_completo TEXT;
  v_rol public.user_role;
BEGIN
  -- 1. Nombre completo: usar metadata si está, fallback al email
  v_nombre_completo := COALESCE(
    NEW.raw_user_meta_data->>'nombre_completo',
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );

  -- 2. Rol: leer de metadata, validar contra enum, default 'vendedor'
  BEGIN
    v_rol := COALESCE(
      (NEW.raw_user_meta_data->>'rol')::public.user_role,
      'vendedor'::public.user_role
    );
  EXCEPTION WHEN invalid_text_representation THEN
    -- Si el valor del rol no matchea el enum, fallback a vendedor
    v_rol := 'vendedor'::public.user_role;
  END;

  -- 3. Insertar en public.usuarios
  INSERT INTO public.usuarios (
    id,
    email,
    nombre_completo,
    rol,
    activo,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_nombre_completo,
    v_rol,
    TRUE,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Loguear pero NO bloquear el INSERT en auth.users.
  -- Si falla la creación del perfil, el admin lo resuelve manualmente
  -- desde el SQL editor. Es preferible eso a que el signup falle entero.
  RAISE WARNING '[handle_new_user] Falló al crear perfil para %: %',
    NEW.email, SQLERRM;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Triggers asociados (drop si existían + create)
-- ----------------------------------------------------------------------------

-- Audit log inmutable
DROP TRIGGER IF EXISTS trg_audit_no_update ON public.audit_log;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_changes();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON public.audit_log;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_changes();

-- Validación de puntos de venta en configuracion
DROP TRIGGER IF EXISTS trg_configuracion_pv ON public.configuracion;
CREATE TRIGGER trg_configuracion_pv
  BEFORE INSERT OR UPDATE ON public.configuracion
  FOR EACH ROW EXECUTE FUNCTION public.validar_puntos_venta();

-- updated_at en configuracion (faltaba en init)
DROP TRIGGER IF EXISTS trg_configuracion_set_updated_at ON public.configuracion;
CREATE TRIGGER trg_configuracion_set_updated_at
  BEFORE UPDATE ON public.configuracion
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Creación automática de fila en public.usuarios al insertarse auth.users
DROP TRIGGER IF EXISTS trg_handle_new_user ON auth.users;
CREATE TRIGGER trg_handle_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- BLOQUE 2b — Re-create policies usando es_superadmin() y get_empresa_id()
-- ============================================================================
-- Reemplaza las policies del init que usaban es_superadmin(auth.uid()) y
-- current_empresa_id() por las firmas reales de Loom Point.

CREATE POLICY empresas_select ON public.empresas FOR SELECT
  USING (public.es_superadmin() OR id = public.get_empresa_id());

CREATE POLICY usuarios_select ON public.usuarios FOR SELECT
  USING (
    public.es_superadmin()
    OR (empresa_id = public.get_empresa_id() AND rol <> 'superadmin')
    OR id = auth.uid()
  );

CREATE POLICY configuracion_select ON public.configuracion FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY audit_log_select ON public.audit_log FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY catalogo_categorias_select ON public.catalogo_categorias FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY catalogo_categorias_write ON public.catalogo_categorias FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY categoria_atributos_select ON public.categoria_atributos FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY categoria_atributos_write ON public.categoria_atributos FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY clientes_select ON public.clientes FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY clientes_write ON public.clientes FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY productos_select ON public.productos FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY productos_write ON public.productos FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY variantes_select ON public.variantes FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY variantes_write ON public.variantes FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY ventas_select ON public.ventas FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY items_venta_select ON public.items_venta FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY medios_pago_venta_select ON public.medios_pago_venta FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY pagos_select ON public.pagos FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY facturas_select ON public.facturas FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY facturas_afip_select ON public.facturas_afip FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY sucursales_select ON public.sucursales FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY sucursales_write ON public.sucursales FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

CREATE POLICY cajas_select ON public.cajas FOR SELECT
  USING (
    public.es_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = public.get_empresa_id()
    )
  );

CREATE POLICY cajas_write ON public.cajas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = public.get_empresa_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = public.get_empresa_id()
    )
  );

-- ============================================================================
-- BLOQUE 3 — RPCs operativas (con adaptaciones A y B donde corresponde)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 cerrar_venta
-- Adaptación A: INSERT items_venta usa variante_atributos jsonb.
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

  -- Mutex de recargos
  IF p_recargo_factura_completa AND p_recargo_porcentaje_manual IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden aplicar ambos recargos (10,5%% factura completa Y recargo manual) en la misma venta';
  END IF;

  -- Validación del porcentaje manual
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

  IF p_cliente_id IS NOT NULL THEN
    PERFORM 1 FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no pertenece a la empresa del usuario';
    END IF;
  END IF;

  v_nombre_custom_clean := NULLIF(TRIM(COALESCE(p_nombre_cliente_custom, '')), '');
  v_recargo_motivo_clean := NULLIF(TRIM(COALESCE(p_recargo_motivo, '')), '');

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

  -- Validación recargo 10,5%
  IF p_recargo_factura_completa THEN
    IF p_tipo_factura = 'sin_factura' THEN
      RAISE EXCEPTION 'No se puede aplicar recargo del 10,5%% sin emitir factura';
    END IF;
    IF abs(p_monto_facturado - round(v_total_neto * 1.105, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Con recargo del 10,5%%, el monto facturado debe igualar al total cobrado (%, esperado %)',
        p_monto_facturado, round(v_total_neto * 1.105, 2);
    END IF;
  END IF;

  -- Cálculo del total a cobrar (con recargo aplicado si corresponde).
  -- Prioridad: recargo_factura_completa > recargo_manual > sin recargo.
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
    recargo_motivo
  ) VALUES (
    p_canal::canal_venta, p_usuario_id, p_cliente_id,
    v_subtotal, p_descuento_total, v_total_a_cobrar,
    'cerrada'::venta_estado, p_tipo_factura, p_monto_facturado,
    p_nota_interna, NOW(), v_empresa_id,
    v_nombre_custom_clean,
    p_recargo_factura_completa,
    p_recargo_porcentaje_manual,
    v_recargo_motivo_clean
  )
  RETURNING id, numero INTO v_venta_id, v_venta_numero;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- ADAPTACIÓN A: variante_atributos jsonb reemplaza (variante_color, variante_talle)
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

-- ----------------------------------------------------------------------------
-- 3.2 guardar_pedido
-- Adaptación A: INSERT items_venta usa variante_atributos jsonb.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guardar_pedido(
  p_usuario_id uuid,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_canal text DEFAULT 'mostrador'::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_nota_interna text DEFAULT NULL::text,
  p_nombre_cliente_custom text DEFAULT NULL::text
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
  v_item jsonb;
  v_variante_activa boolean;
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
    RAISE EXCEPTION 'El pedido debe tener al menos un item';
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
    SELECT v.activa
    INTO v_variante_activa
    FROM public.variantes v
    WHERE v.id = (v_item->>'variante_id')::uuid
      AND v.empresa_id = v_empresa_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante % no encontrada o no pertenece a la empresa',
        v_item->>'variante_id';
    END IF;
    IF NOT v_variante_activa THEN
      RAISE EXCEPTION 'La variante % está inactiva', v_item->>'variante_sku';
    END IF;
    v_subtotal := v_subtotal + (v_item->>'subtotal_neto')::numeric;
  END LOOP;

  INSERT INTO public.ventas (
    canal, usuario_id, cliente_id,
    subtotal_neto, descuento_total, total,
    estado, tipo_factura, monto_facturado,
    nota_interna, closed_at, empresa_id,
    nombre_cliente_custom
  ) VALUES (
    p_canal::canal_venta, p_usuario_id, p_cliente_id,
    v_subtotal, 0, v_subtotal,
    'guardada'::venta_estado, 'sin_factura'::tipo_factura, 0,
    p_nota_interna, NULL, v_empresa_id,
    v_nombre_custom_clean
  )
  RETURNING id, numero INTO v_venta_id, v_venta_numero;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- ADAPTACIÓN A: variante_atributos jsonb reemplaza (variante_color, variante_talle)
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
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'numero', v_venta_numero,
    'subtotal_neto', v_subtotal
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3.3 finalizar_pedido
-- Sin adaptación (no toca items_venta).
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

-- ----------------------------------------------------------------------------
-- 3.4 ajustar_stock
-- Sin adaptación.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ajustar_stock(
  p_variante_id uuid,
  p_delta integer,
  p_motivo text,
  p_usuario_id uuid,
  p_permitir_negativo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_actual int;
  v_stock_nuevo int;
  v_usuario_email text;
  v_producto_id uuid;
  v_producto_nombre text;
  v_variante_sku text;
  v_empresa_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT empresa_id INTO v_empresa_id FROM public.usuarios WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;
  IF v_empresa_id IS NULL THEN RAISE EXCEPTION 'Usuario sin empresa asignada'; END IF;

  SELECT v.stock, v.producto_id, v.sku_variante, p.nombre
  INTO v_stock_actual, v_producto_id, v_variante_sku, v_producto_nombre
  FROM public.variantes v
  JOIN public.productos p ON p.id = v.producto_id
  WHERE v.id = p_variante_id AND v.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante no existe o no pertenece a la empresa';
  END IF;

  v_stock_nuevo := v_stock_actual + p_delta;
  IF NOT p_permitir_negativo AND v_stock_nuevo < 0 THEN
    RAISE EXCEPTION 'Stock no puede quedar negativo (actual: %, ajuste: %)', v_stock_actual, p_delta;
  END IF;

  UPDATE public.variantes SET stock = v_stock_nuevo
  WHERE id = p_variante_id AND empresa_id = v_empresa_id;

  BEGIN
    SELECT email INTO v_usuario_email FROM public.usuarios WHERE id = p_usuario_id;
    INSERT INTO public.audit_log (
      usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle, empresa_id
    ) VALUES (
      p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
      'variantes', p_variante_id, 'ajustar_stock',
      jsonb_build_object(
        'producto_nombre', v_producto_nombre,
        'variante_sku', v_variante_sku,
        'stock_anterior', v_stock_actual,
        'delta', p_delta,
        'stock_nuevo', v_stock_nuevo,
        'motivo', p_motivo,
        'permitir_negativo', p_permitir_negativo
      ),
      v_empresa_id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'stock_anterior', v_stock_actual, 'stock_nuevo', v_stock_nuevo);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3.5 anular_venta
-- Sin adaptación. RETURNS ventas (la row entera).
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

  -- Validar pertenencia a empresa (excepción: superadmin sin empresa activa
  -- puede anular ventas de cualquier empresa al impersonar).
  IF v_usuario_empresa_id IS NOT NULL
     AND v_venta.empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'No tenés permisos para anular esta venta';
  END IF;

  IF v_venta.estado = 'anulada' THEN
    RAISE EXCEPTION 'La venta ya está anulada';
  END IF;

  -- Validación de factura aprobada activa.
  -- Excluimos NC/ND (factura_asociada_id IS NOT NULL): no son facturas
  -- activas sino comprobantes asociados a una factura.
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
    UPDATE public.variantes v
    SET stock = v.stock + iv.cantidad,
        updated_at = NOW()
    FROM public.items_venta iv, public.productos p
    WHERE iv.venta_id = p_venta_id
      AND iv.variante_id = v.id
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

-- ----------------------------------------------------------------------------
-- 3.6 anular_pedido
-- Sin adaptación. No existía como stub en init.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.anular_pedido(
  p_pedido_id uuid,
  p_motivo text,
  p_ip inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_estado_actual venta_estado;
  v_venta_numero bigint;
  v_pedido_empresa_id uuid;
  v_usuario_empresa_id uuid;
  v_usuario_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede anular pedidos';
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT empresa_id INTO v_usuario_empresa_id
  FROM public.usuarios
  WHERE id = auth.uid() AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  SELECT estado, numero, empresa_id
  INTO v_estado_actual, v_venta_numero, v_pedido_empresa_id
  FROM public.ventas
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no encontrado', p_pedido_id;
  END IF;

  -- Validar pertenencia a empresa (excepción: superadmin sin empresa activa).
  IF v_usuario_empresa_id IS NOT NULL
     AND v_pedido_empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'No tenés permisos para anular este pedido';
  END IF;

  IF v_estado_actual <> 'guardada'::venta_estado THEN
    RAISE EXCEPTION 'Solo se pueden anular pedidos en estado guardada (estado actual: %)',
      v_estado_actual;
  END IF;

  UPDATE public.ventas
  SET estado = 'anulada'::venta_estado,
      updated_at = NOW(),
      nota_interna = COALESCE(nota_interna || E'\n---\nANULADA: ', 'ANULADA: ') || p_motivo
  WHERE id = p_pedido_id;

  SELECT email INTO v_usuario_email
  FROM public.usuarios WHERE id = auth.uid();

  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot,
    entidad, entidad_id, accion, detalle,
    ip, user_agent, empresa_id
  ) VALUES (
    auth.uid(), v_usuario_email,
    'pedido', p_pedido_id, 'anular',
    jsonb_build_object(
      'numero', v_venta_numero,
      'motivo', p_motivo,
      'estado_previo', v_estado_actual
    ),
    p_ip, p_user_agent, v_pedido_empresa_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', p_pedido_id,
    'numero', v_venta_numero
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3.7 editar_venta
-- Adaptación A: INSERT items_venta usa variante_atributos jsonb.
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
  FOR r_delta IN
    WITH viejos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id, SUM((e->>'cantidad')::int)::int AS cantidad
      FROM jsonb_array_elements(v_items_viejos) e GROUP BY (e->>'variante_id')::uuid
    ),
    nuevos AS (
      SELECT (e->>'variante_id')::uuid AS variante_id, SUM((e->>'cantidad')::int)::int AS cantidad
      FROM jsonb_array_elements(p_items_nuevos) e GROUP BY (e->>'variante_id')::uuid
    )
    SELECT COALESCE(n.variante_id, v.variante_id) AS variante_id, (COALESCE(n.cantidad, 0) - COALESCE(v.cantidad, 0))::int AS delta_items
    FROM viejos v FULL OUTER JOIN nuevos n ON v.variante_id = n.variante_id
  LOOP
    IF r_delta.delta_items = 0 THEN
      CONTINUE;
    END IF;
    PERFORM public.ajustar_stock(r_delta.variante_id, (-r_delta.delta_items)::int, v_motivo_ajuste, p_usuario_id, true);
    v_stock_ajustes := v_stock_ajustes || jsonb_build_array(jsonb_build_object('variante_id', r_delta.variante_id, 'delta_items', r_delta.delta_items, 'delta_aplicado', -r_delta.delta_items, 'motivo', v_motivo_ajuste));
    v_stock_ajustes_count := v_stock_ajustes_count + 1;
  END LOOP;
  DELETE FROM public.items_venta WHERE venta_id = p_venta_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    -- ADAPTACIÓN A: variante_atributos jsonb reemplaza (variante_color, variante_talle)
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
    );
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

-- ----------------------------------------------------------------------------
-- 3.8 editar_pedido
-- Adaptación A: INSERT items_venta usa variante_atributos jsonb.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.editar_pedido(
  p_pedido_id uuid,
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'El usuario no coincide con el caller autenticado';
  END IF;
  SELECT email, empresa_id, rol
  INTO v_usuario_email, v_usuario_empresa_id, v_usuario_rol
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_usuario_rol = 'vendedor' THEN
    RAISE EXCEPTION 'No tenes permisos para editar pedidos';
  END IF;
  IF p_items_nuevos IS NULL OR jsonb_typeof(p_items_nuevos) <> 'array' OR jsonb_array_length(p_items_nuevos) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un item';
  END IF;
  v_cantidad_items := jsonb_array_length(p_items_nuevos);
  SELECT estado, empresa_id, subtotal_neto
  INTO v_pedido_estado, v_empresa_id, v_subtotal_viejo
  FROM public.ventas WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
  END IF;
  IF v_pedido_estado <> 'guardada' THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
  END IF;
  IF v_usuario_empresa_id IS NOT NULL AND v_empresa_id <> v_usuario_empresa_id THEN
    RAISE EXCEPTION 'El pedido no se puede editar';
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
  FROM public.items_venta iv WHERE iv.venta_id = p_pedido_id;
  DELETE FROM public.items_venta WHERE venta_id = p_pedido_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_nuevos)
  LOOP
    -- ADAPTACIÓN A: variante_atributos jsonb reemplaza (variante_color, variante_talle)
    INSERT INTO public.items_venta (
      venta_id, variante_id, producto_nombre, producto_sku, variante_sku,
      variante_atributos, cantidad, precio_unitario_neto, subtotal_neto, empresa_id
    ) VALUES (
      p_pedido_id, (v_item->>'variante_id')::uuid, v_item->>'producto_nombre',
      v_item->>'producto_sku', v_item->>'variante_sku',
      COALESCE(v_item->'variante_atributos', '{}'::jsonb),
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario_neto')::numeric, (v_item->>'subtotal_neto')::numeric,
      v_empresa_id
    );
    v_subtotal := v_subtotal + (v_item->>'subtotal_neto')::numeric;
  END LOOP;
  UPDATE public.ventas SET subtotal_neto = v_subtotal, total = v_subtotal, updated_at = NOW() WHERE id = p_pedido_id;
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle, ip, user_agent, empresa_id
  ) VALUES (
    auth.uid(), v_usuario_email, 'venta', p_pedido_id, 'editar_pedido',
    jsonb_build_object('items_antes', v_items_viejos, 'items_despues', p_items_nuevos, 'subtotal_antes', v_subtotal_viejo, 'subtotal_despues', v_subtotal),
    p_ip::inet, p_user_agent, v_empresa_id
  );
  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id, 'subtotal_neto', v_subtotal, 'cantidad_items', v_cantidad_items);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3.9 importar_productos_bulk
-- Adaptación B: INSERT variantes default usa atributos jsonb '{}', sin color/talle.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.importar_productos_bulk(
  p_usuario_id uuid,
  p_productos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_total integer;
  v_errores jsonb := '[]'::jsonb;
  v_skus_vistos text[] := ARRAY[]::text[];
  v_sku text;
  v_nombre text;
  v_categoria text;
  v_precio numeric;
  v_creados integer := 0;
  v_actualizados integer := 0;
  v_existe boolean;
  v_producto_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede importar productos';
  END IF;

  IF jsonb_typeof(p_productos) <> 'array' THEN
    RAISE EXCEPTION 'p_productos debe ser un array JSON';
  END IF;

  v_total := jsonb_array_length(p_productos);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay productos para importar';
  END IF;
  IF v_total > 5000 THEN
    RAISE EXCEPTION 'Máximo 5000 productos por importación';
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

  -- ============ FASE 1: VALIDACIÓN COMPLETA ============
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_productos)
  LOOP
    v_idx := v_idx + 1;

    v_sku := NULLIF(TRIM(COALESCE(v_item->>'sku_base', '')), '');
    v_nombre := NULLIF(TRIM(COALESCE(v_item->>'nombre', '')), '');
    v_categoria := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    BEGIN
      v_precio := COALESCE((v_item->>'precio_neto')::numeric, -1);
    EXCEPTION WHEN OTHERS THEN
      v_precio := -1;
    END;

    IF v_sku IS NULL THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', '(vacío)', 'motivo', 'SKU vacío');
      CONTINUE;
    END IF;
    IF length(v_sku) > 50 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'SKU mayor a 50 caracteres');
      CONTINUE;
    END IF;
    IF v_sku = ANY(v_skus_vistos) THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'SKU duplicado en el archivo');
      CONTINUE;
    END IF;
    v_skus_vistos := array_append(v_skus_vistos, v_sku);
    IF v_nombre IS NULL THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Nombre vacío');
      CONTINUE;
    END IF;
    IF length(v_nombre) > 200 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Nombre mayor a 200 caracteres');
      CONTINUE;
    END IF;
    IF v_categoria IS NOT NULL AND length(v_categoria) > 100 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Categoría mayor a 100 caracteres');
      CONTINUE;
    END IF;
    IF v_precio < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Precio inválido o no numérico');
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errores) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'total_filas', v_total,
      'validados', 0,
      'errores', v_errores,
      'cantidad_errores', jsonb_array_length(v_errores)
    );
  END IF;

  -- ============ FASE 2: INSERT/UPDATE atómico ============
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_productos)
  LOOP
    v_sku := TRIM(v_item->>'sku_base');
    v_nombre := TRIM(v_item->>'nombre');
    v_categoria := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    v_precio := (v_item->>'precio_neto')::numeric;

    SELECT id INTO v_producto_id
    FROM public.productos
    WHERE sku_base = v_sku AND empresa_id = v_empresa_id
    LIMIT 1;

    v_existe := FOUND;

    IF v_existe THEN
      UPDATE public.productos
      SET nombre = v_nombre,
          categoria = v_categoria,
          precio_neto = v_precio,
          updated_at = NOW()
      WHERE id = v_producto_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      INSERT INTO public.productos (
        sku_base, nombre, categoria, precio_neto,
        empresa_id, activo, track_stock
      ) VALUES (
        v_sku, v_nombre, v_categoria, v_precio,
        v_empresa_id, true, true
      )
      RETURNING id INTO v_producto_id;

      -- ADAPTACIÓN B: variantes.atributos jsonb (en vez de color/talle).
      -- La variante DEFAULT arranca sin atributos: {}.
      INSERT INTO public.variantes (
        producto_id, atributos, sku_variante, stock, activa, empresa_id
      ) VALUES (
        v_producto_id, '{}'::jsonb, v_sku || '-DEFAULT', 0, true, v_empresa_id
      );

      v_creados := v_creados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'creados', v_creados,
    'actualizados', v_actualizados
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3.10 persistir_cae_y_marcar_emitida
-- Sin adaptación.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.persistir_cae_y_marcar_emitida(
  p_factura_id uuid,
  p_venta_id uuid,
  p_empresa_id uuid,
  p_cae text,
  p_cae_vencimiento date,
  p_numero_comprobante bigint,
  p_raw_response jsonb,
  p_request_log_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factura_actualizada uuid;
  v_venta_actualizada uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  UPDATE public.facturas_afip
  SET estado = 'aprobada',
      cae = p_cae,
      cae_vencimiento = p_cae_vencimiento,
      numero_comprobante = p_numero_comprobante,
      raw_response = p_raw_response,
      error_mensaje = NULL,
      updated_at = NOW()
  WHERE id = p_factura_id
    AND empresa_id = p_empresa_id
  RETURNING id INTO v_factura_actualizada;

  IF v_factura_actualizada IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada o no pertenece a empresa %', p_factura_id, p_empresa_id;
  END IF;

  UPDATE public.ventas
  SET estado_facturacion_afip = 'emitida',
      ultimo_request_log_id = p_request_log_id,
      ultimo_error_facturacion = NULL,
      ultimo_intento_facturacion_at = NOW(),
      updated_at = NOW()
  WHERE id = p_venta_id
    AND empresa_id = p_empresa_id
  RETURNING id INTO v_venta_actualizada;

  IF v_venta_actualizada IS NULL THEN
    RAISE EXCEPTION 'Venta % no encontrada o no pertenece a empresa %', p_venta_id, p_empresa_id;
  END IF;
END;
$function$;

-- ============================================================================
-- BLOQUE 4 — Reportes
-- ============================================================================
-- DROP el overload viejo sin p_busqueda_texto (deuda técnica que no se arrastra).

DROP FUNCTION IF EXISTS public.ventas_totales_filtrados(timestamptz, timestamptz, text, text, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.reporte_ventas_agregado(
  p_desde timestamptz,
  p_hasta timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with ventas_filtradas as (
  select
    v.id,
    v.total,
    v.cliente_id,
    v.created_at::date as fecha,
    coalesce(
      (select sum(iv.cantidad)::int from items_venta iv where iv.venta_id = v.id),
      0
    ) as unidades
  from ventas v
  where v.estado = 'cerrada'
    and v.created_at >= p_desde
    and v.created_at <= p_hasta
)
select jsonb_build_object(
  'kpis', jsonb_build_object(
    'ventas_total', (select count(*) from ventas_filtradas),
    'ventas_monto_neto', (select coalesce(sum(total), 0) from ventas_filtradas),
    'unidades', (select coalesce(sum(unidades), 0) from ventas_filtradas),
    'clientes_unicos', (select count(distinct cliente_id) from ventas_filtradas where cliente_id is not null)
  ),
  'por_dia', coalesce(
    (select jsonb_agg(jsonb_build_object(
      'fecha', fecha,
      'monto_neto', monto_neto,
      'cantidad', cantidad
    ) order by fecha)
    from (
      select fecha, sum(total) as monto_neto, count(*) as cantidad
      from ventas_filtradas
      group by fecha
      order by fecha
    ) t
  ), '[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.ventas_totales_filtrados(
  p_desde timestamptz DEFAULT NULL::timestamptz,
  p_hasta timestamptz DEFAULT NULL::timestamptz,
  p_estado text DEFAULT NULL::text,
  p_tipo_factura text DEFAULT NULL::text,
  p_usuario_id uuid DEFAULT NULL::uuid,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_numero integer DEFAULT NULL::integer,
  p_busqueda_texto text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  with v as (
    select v.*
    from ventas v
    where
      (p_desde is null or v.created_at >= p_desde)
      and (p_hasta is null or v.created_at <= p_hasta)
      and (p_estado is null or v.estado::text = p_estado)
      and (p_tipo_factura is null or v.tipo_factura::text = p_tipo_factura)
      and (p_usuario_id is null or v.usuario_id = p_usuario_id)
      and (p_cliente_id is null or v.cliente_id = p_cliente_id)
      and (p_numero is null or v.numero = p_numero)
      and (
        p_busqueda_texto is null
        or v.nombre_cliente_custom ILIKE '%' || p_busqueda_texto || '%'
      )
  ),
  v_activas as (
    select * from v where estado != 'anulada'::venta_estado
  )
  select jsonb_build_object(
    'cantidad', (select count(*) from v_activas),
    'monto_total_neto', (select coalesce(sum(total), 0) from v_activas),
    'unidades_vendidas', (
      select coalesce(sum(iv.cantidad), 0)
      from items_venta iv
      where iv.venta_id in (select id from v_activas)
    )
  );
$function$;

-- ============================================================================
-- BLOQUE 5 — Funciones de superadmin (sa_*)
-- ============================================================================
-- Sin adaptación. row_to_json en sa_exportar_datos toma columnas actuales
-- del schema (variantes.atributos en vez de color/talle) automáticamente.

CREATE OR REPLACE FUNCTION public.sa_exportar_datos(
  p_motivo text,
  p_tabla text DEFAULT NULL::text,
  p_empresa_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_email text;
  v_empresas_afectadas jsonb;
  v_alcance text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: requiere rol superadmin';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Motivo obligatorio (mínimo 10 caracteres)';
  END IF;

  IF p_empresa_id IS NOT NULL THEN
    PERFORM 1 FROM public.empresas WHERE id = p_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa no encontrada: %', p_empresa_id;
    END IF;
    v_alcance := 'empresa_unica';
  ELSE
    v_alcance := 'todas_las_empresas';
  END IF;

  IF p_tabla IS NULL OR p_tabla = 'todas' THEN
    v_result := jsonb_build_object(
      'usuarios', (
        SELECT jsonb_agg(row_to_json(u)) FROM public.usuarios u
        WHERE p_empresa_id IS NULL OR u.empresa_id = p_empresa_id
      ),
      'clientes', (
        SELECT jsonb_agg(row_to_json(c)) FROM public.clientes c
        WHERE p_empresa_id IS NULL OR c.empresa_id = p_empresa_id
      ),
      'productos', (
        SELECT jsonb_agg(row_to_json(p)) FROM public.productos p
        WHERE p_empresa_id IS NULL OR p.empresa_id = p_empresa_id
      ),
      'variantes', (
        SELECT jsonb_agg(row_to_json(v)) FROM public.variantes v
        WHERE p_empresa_id IS NULL OR v.empresa_id = p_empresa_id
      ),
      'ventas', (
        SELECT jsonb_agg(row_to_json(v)) FROM public.ventas v
        WHERE p_empresa_id IS NULL OR v.empresa_id = p_empresa_id
      ),
      'items_venta', (
        SELECT jsonb_agg(row_to_json(iv)) FROM public.items_venta iv
        WHERE p_empresa_id IS NULL OR iv.empresa_id = p_empresa_id
      ),
      'pagos', (
        SELECT jsonb_agg(row_to_json(p)) FROM public.pagos p
        WHERE p_empresa_id IS NULL OR p.empresa_id = p_empresa_id
      ),
      'facturas', (
        SELECT jsonb_agg(row_to_json(f)) FROM public.facturas f
        WHERE p_empresa_id IS NULL OR f.empresa_id = p_empresa_id
      ),
      'exportado_at', now(),
      'motivo', p_motivo,
      'alcance', v_alcance,
      'empresa_id_filtro', p_empresa_id
    );
  ELSIF p_tabla = 'ventas' THEN
    v_result := jsonb_build_object(
      'ventas', (
        SELECT jsonb_agg(row_to_json(v)) FROM public.ventas v
        WHERE p_empresa_id IS NULL OR v.empresa_id = p_empresa_id
      ),
      'items_venta', (
        SELECT jsonb_agg(row_to_json(iv)) FROM public.items_venta iv
        WHERE p_empresa_id IS NULL OR iv.empresa_id = p_empresa_id
      ),
      'pagos', (
        SELECT jsonb_agg(row_to_json(p)) FROM public.pagos p
        WHERE p_empresa_id IS NULL OR p.empresa_id = p_empresa_id
      ),
      'motivo', p_motivo,
      'alcance', v_alcance,
      'empresa_id_filtro', p_empresa_id
    );
  ELSE
    RAISE EXCEPTION 'Tabla no válida o no soportada: %', p_tabla;
  END IF;

  IF p_empresa_id IS NOT NULL THEN
    SELECT jsonb_build_array(
      jsonb_build_object('id', id, 'nombre', nombre)
    ) INTO v_empresas_afectadas
    FROM public.empresas WHERE id = p_empresa_id;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre))
    INTO v_empresas_afectadas
    FROM public.empresas;
  END IF;

  SELECT email INTO v_email FROM public.usuarios WHERE id = auth.uid();
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, accion, detalle,
    es_accion_superadmin, motivo_superadmin, empresa_id
  ) VALUES (
    auth.uid(), v_email, 'sistema', 'exportar_datos',
    jsonb_build_object(
      'tabla', COALESCE(p_tabla, 'todas'),
      'alcance', v_alcance,
      'empresas_afectadas', v_empresas_afectadas
    ),
    true, p_motivo, p_empresa_id
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sa_forzar_estado_venta(
  p_venta_id uuid,
  p_nuevo_estado venta_estado,
  p_motivo text
)
RETURNS public.ventas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venta public.ventas;
  v_estado_previo venta_estado;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: requiere rol superadmin';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Motivo obligatorio (mínimo 10 caracteres)';
  END IF;

  SELECT * INTO v_venta FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_estado_previo := v_venta.estado;

  UPDATE public.ventas
  SET estado = p_nuevo_estado, updated_at = now()
  WHERE id = p_venta_id
  RETURNING * INTO v_venta;

  SELECT email INTO v_email FROM public.usuarios WHERE id = auth.uid();
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle,
    es_accion_superadmin, motivo_superadmin, empresa_id
  ) VALUES (
    auth.uid(), v_email, 'venta', p_venta_id, 'forzar_estado',
    jsonb_build_object(
      'estado_previo', v_estado_previo,
      'estado_nuevo', p_nuevo_estado,
      'numero', v_venta.numero
    ),
    true, p_motivo, v_venta.empresa_id
  );

  RETURN v_venta;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sa_health_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: requiere rol superadmin';
  END IF;

  v_result := jsonb_build_object(
    'timestamp', now(),
    'total_usuarios', (SELECT count(*) FROM public.usuarios WHERE activo = true),
    'usuarios_por_rol', (
      SELECT jsonb_object_agg(rol, cantidad)
      FROM (SELECT rol, count(*) AS cantidad FROM public.usuarios WHERE activo GROUP BY rol) r
    ),
    'total_productos_activos', (SELECT count(*) FROM public.productos WHERE activo = true),
    'total_variantes_activas', (SELECT count(*) FROM public.variantes WHERE activa = true),
    'ventas_hoy', (SELECT count(*) FROM public.ventas WHERE created_at::date = current_date),
    'ventas_abiertas', (SELECT count(*) FROM public.ventas WHERE estado = 'abierta'),
    'ventas_guardadas', (SELECT count(*) FROM public.ventas WHERE estado = 'guardada'),
    'pagos_pendientes', (SELECT count(*) FROM public.pagos WHERE estado = 'pendiente'),
    'webhooks_sin_procesar', (SELECT count(*) FROM public.mp_webhook_events WHERE procesado = false),
    'facturas_hoy', (SELECT count(*) FROM public.facturas WHERE created_at::date = current_date),
    'variantes_sin_stock', (SELECT count(*) FROM public.variantes WHERE activa = true AND stock = 0),
    'variantes_stock_bajo', (SELECT count(*) FROM public.variantes WHERE activa = true AND stock > 0 AND stock < 5),
    'ultimo_audit_log', (SELECT max(created_at) FROM public.audit_log),
    'total_audit_log_entries', (SELECT count(*) FROM public.audit_log),
    'acciones_superadmin_ultimos_30_dias', (
      SELECT count(*) FROM public.audit_log
      WHERE es_accion_superadmin = true
        AND created_at > now() - interval '30 days'
    )
  );

  SELECT email INTO v_email FROM public.usuarios WHERE id = auth.uid();
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, accion,
    es_accion_superadmin, motivo_superadmin
  ) VALUES (
    auth.uid(), v_email, 'sistema', 'health_check',
    true, 'Revisión de salud del sistema'
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sa_reparar_stock(
  p_variante_id uuid,
  p_nuevo_stock integer,
  p_motivo text
)
RETURNS public.variantes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_variante public.variantes;
  v_stock_previo integer;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: requiere rol superadmin';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Motivo obligatorio (mínimo 10 caracteres)';
  END IF;
  IF p_nuevo_stock < 0 THEN
    RAISE EXCEPTION 'El stock no puede ser negativo';
  END IF;

  SELECT * INTO v_variante FROM public.variantes WHERE id = p_variante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante no encontrada'; END IF;

  v_stock_previo := v_variante.stock;

  UPDATE public.variantes
  SET stock = p_nuevo_stock, updated_at = now()
  WHERE id = p_variante_id
  RETURNING * INTO v_variante;

  SELECT email INTO v_email FROM public.usuarios WHERE id = auth.uid();
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle,
    es_accion_superadmin, motivo_superadmin, empresa_id
  ) VALUES (
    auth.uid(), v_email, 'variante', p_variante_id, 'reparar_stock',
    jsonb_build_object(
      'stock_previo', v_stock_previo,
      'stock_nuevo', p_nuevo_stock,
      'diferencia', p_nuevo_stock - v_stock_previo
    ),
    true, p_motivo, v_variante.empresa_id
  );

  RETURN v_variante;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sa_simular_vista_usuario(
  p_usuario_id uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario public.usuarios;
  v_ventas_hoy integer;
  v_ventas_guardadas integer;
  v_ultimas_ventas jsonb;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_superadmin() THEN
    RAISE EXCEPTION 'Acceso denegado: requiere rol superadmin';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Motivo obligatorio (mínimo 10 caracteres)';
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado'; END IF;

  SELECT count(*) INTO v_ventas_hoy
  FROM public.ventas
  WHERE usuario_id = p_usuario_id AND created_at::date = current_date;

  SELECT count(*) INTO v_ventas_guardadas
  FROM public.ventas
  WHERE usuario_id = p_usuario_id AND estado = 'guardada';

  SELECT jsonb_agg(row_to_json(v)) INTO v_ultimas_ventas
  FROM (
    SELECT id, numero, total, estado, created_at
    FROM public.ventas
    WHERE usuario_id = p_usuario_id
    ORDER BY created_at DESC
    LIMIT 10
  ) v;

  SELECT email INTO v_email FROM public.usuarios WHERE id = auth.uid();
  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle,
    es_accion_superadmin, motivo_superadmin, empresa_id
  ) VALUES (
    auth.uid(), v_email, 'usuario', p_usuario_id, 'simular_vista',
    jsonb_build_object('usuario_afectado', v_usuario.email),
    true, p_motivo, v_usuario.empresa_id
  );

  RETURN jsonb_build_object(
    'usuario', row_to_json(v_usuario),
    'ventas_hoy', v_ventas_hoy,
    'ventas_guardadas', v_ventas_guardadas,
    'ultimas_10_ventas', v_ultimas_ventas
  );
END;
$function$;

-- Defense in depth: solo service_role / postgres puede invocar sa_*.
REVOKE EXECUTE ON FUNCTION public.sa_exportar_datos(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_forzar_estado_venta(uuid, venta_estado, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_health_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_reparar_stock(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_simular_vista_usuario(uuid, text) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- BLOQUE 6 — Auth helper: registrar_login
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_login(
  p_ip inet DEFAULT NULL::inet,
  p_user_agent text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_email text;
begin
  update public.usuarios
  set ultimo_login_at = now(),
      ultimo_login_ip = p_ip,
      ultimo_login_user_agent = p_user_agent
  where id = auth.uid()
  returning email into v_email;

  insert into public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, ip, user_agent
  ) values (
    auth.uid(), v_email, 'auth', auth.uid(), 'login', p_ip, p_user_agent
  );
end;
$function$;

-- ============================================================================
-- GRANTS para las RPCs operativas
-- ============================================================================
-- El init ya hizo REVOKE EXECUTE ... FROM PUBLIC y GRANT ... TO authenticated
-- para las stubs. Como las dropeamos y recreamos, repetimos los grants.
-- (Las firmas cambiaron en algunas, así que GRANT por nombre genérico cubre
-- la nueva versión.)

REVOKE EXECUTE ON FUNCTION public.cerrar_venta(uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric, text, text, boolean, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guardar_pedido(uuid, uuid, text, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.editar_pedido(uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ajustar_stock(uuid, integer, text, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anular_venta(uuid, text, inet, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anular_pedido(uuid, text, inet, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalizar_pedido(uuid, uuid, jsonb, numeric, tipo_factura, numeric, text, boolean, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persistir_cae_y_marcar_emitida(uuid, uuid, uuid, text, date, bigint, jsonb, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_login(inet, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cerrar_venta(uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric, text, text, boolean, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_pedido(uuid, uuid, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_pedido(uuid, uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_venta(uuid, uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_stock(uuid, integer, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_venta(uuid, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_pedido(uuid, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_pedido(uuid, uuid, jsonb, numeric, tipo_factura, numeric, text, boolean, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persistir_cae_y_marcar_emitida(uuid, uuid, uuid, text, date, bigint, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_login(inet, text) TO authenticated;
