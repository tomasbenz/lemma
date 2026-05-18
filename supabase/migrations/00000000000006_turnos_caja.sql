-- ============================================================================
-- Lemma — Módulo de Turnos de Caja
-- ============================================================================
--
-- Agrega el concepto de "turno de caja": apertura con base inicial, cierre
-- con conteo declarado, asociación de ventas/pedidos al turno.
--
-- Reglas:
--   * Un solo turno abierto por caja a la vez (UNIQUE parcial).
--   * Toda venta/pedido nuevo se asocia al turno activo de la caja del
--     usuario (resuelto vía get_default_caja_id en single-caja).
--   * Sin turno abierto → cerrar_venta y guardar_pedido fallan con mensaje
--     claro ("No hay turno de caja abierto. Abrí un turno antes de vender.").
--   * Las ventas pre-existentes a esta migration quedan con turno_id=NULL.
--   * Los admins pueden forzar el cierre (forzar_cierre_turno) cuando una
--     cajera olvida cerrarlo. Queda flag forzado_por_admin=true y motivo.
--
-- Multi-tenant: turnos_caja tiene empresa_id directo (no se resuelve via
-- caja→sucursal en cada policy) para simplificar RLS y queries.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOQUE A — Tabla turnos_caja
-- ----------------------------------------------------------------------------

CREATE TABLE public.turnos_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE RESTRICT,
  usuario_apertura_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  usuario_cierre_id uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  abierto_at timestamptz NOT NULL DEFAULT now(),
  cerrado_at timestamptz,
  base_inicial numeric(12, 2) NOT NULL,
  nota_apertura text,
  total_declarado numeric(12, 2),
  diferencia numeric(12, 2),
  nota_cierre text,
  forzado_por_admin boolean NOT NULL DEFAULT false,
  motivo_forzado text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX turnos_caja_empresa_idx ON public.turnos_caja(empresa_id);
CREATE INDEX turnos_caja_caja_idx ON public.turnos_caja(caja_id);
CREATE INDEX turnos_caja_usuario_apertura_idx
  ON public.turnos_caja(usuario_apertura_id);
CREATE INDEX turnos_caja_abierto_at_idx ON public.turnos_caja(abierto_at DESC);

-- Un solo turno abierto por caja a la vez. Si Samu quiere permitir
-- simultáneos en el futuro, se reemplaza este index.
CREATE UNIQUE INDEX turnos_caja_uno_abierto_por_caja_unq
  ON public.turnos_caja(caja_id)
  WHERE cerrado_at IS NULL;

CREATE TRIGGER turnos_caja_set_updated_at
  BEFORE UPDATE ON public.turnos_caja
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.turnos_caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY turnos_caja_select ON public.turnos_caja FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

CREATE POLICY turnos_caja_write ON public.turnos_caja FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

-- ----------------------------------------------------------------------------
-- BLOQUE B — Columna turno_id en ventas
-- ----------------------------------------------------------------------------

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS turno_id uuid
    REFERENCES public.turnos_caja(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ventas_turno_idx ON public.ventas(turno_id);

-- ----------------------------------------------------------------------------
-- BLOQUE C — RPCs operativas de turno
-- ----------------------------------------------------------------------------

-- abrir_turno
-- Crea un turno abierto en la caja indicada con base inicial. Valida que
-- la caja exista, esté activa y pertenezca a la empresa del caller.

CREATE OR REPLACE FUNCTION public.abrir_turno(
  p_caja_id uuid,
  p_base_inicial numeric,
  p_nota_apertura text DEFAULT NULL
)
RETURNS public.turnos_caja
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_user_empresa_id uuid;
  v_caja_activa boolean;
  v_caja_sucursal_empresa uuid;
  v_existe_abierto boolean;
  v_turno public.turnos_caja;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_base_inicial IS NULL OR p_base_inicial < 0 THEN
    RAISE EXCEPTION 'La base inicial debe ser un número mayor o igual a cero';
  END IF;

  SELECT email, empresa_id
  INTO v_user_email, v_user_empresa_id
  FROM public.usuarios
  WHERE id = v_user_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  IF v_user_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- Validar caja: activa + pertenece a la empresa del caller via sucursal.
  SELECT c.activa, s.empresa_id
  INTO v_caja_activa, v_caja_sucursal_empresa
  FROM public.cajas c
  JOIN public.sucursales s ON s.id = c.sucursal_id
  WHERE c.id = p_caja_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La caja no existe';
  END IF;

  IF NOT v_caja_activa THEN
    RAISE EXCEPTION 'La caja no está activa';
  END IF;

  IF v_caja_sucursal_empresa <> v_user_empresa_id THEN
    RAISE EXCEPTION 'La caja no pertenece a la empresa del usuario';
  END IF;

  -- Pre-check explícito del turno abierto (defense in depth — el UNIQUE
  -- index también lo previene pero damos mensaje claro).
  SELECT EXISTS(
    SELECT 1 FROM public.turnos_caja
    WHERE caja_id = p_caja_id AND cerrado_at IS NULL
  ) INTO v_existe_abierto;

  IF v_existe_abierto THEN
    RAISE EXCEPTION 'Ya hay un turno abierto en esta caja';
  END IF;

  INSERT INTO public.turnos_caja (
    empresa_id, caja_id, usuario_apertura_id,
    abierto_at, base_inicial, nota_apertura
  ) VALUES (
    v_user_empresa_id, p_caja_id, v_user_id,
    NOW(), p_base_inicial, NULLIF(TRIM(COALESCE(p_nota_apertura, '')), '')
  )
  RETURNING * INTO v_turno;

  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot,
    entidad, entidad_id, accion, detalle, empresa_id
  ) VALUES (
    v_user_id, v_user_email,
    'turno_caja', v_turno.id, 'abrir',
    jsonb_build_object(
      'caja_id', p_caja_id,
      'base_inicial', p_base_inicial,
      'nota_apertura', v_turno.nota_apertura
    ),
    v_user_empresa_id
  );

  RETURN v_turno;
END;
$function$;

-- resumen_turno
-- Devuelve totales del turno SIN cerrarlo. Útil para preview en el modal de
-- cierre antes de confirmar. Lee de medios_pago_venta + items_venta filtrando
-- por venta.turno_id y excluyendo ventas anuladas en el cálculo de
-- "total efectivo en caja". Sí cuenta cantidad de anulaciones aparte.

CREATE OR REPLACE FUNCTION public.resumen_turno(p_turno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_empresa_id uuid;
  v_turno public.turnos_caja;
  v_total_efectivo_ventas numeric := 0;
  v_total_teorico_efectivo numeric := 0;
  v_totales_por_medio jsonb;
  v_cantidad_ventas int := 0;
  v_cantidad_anulaciones int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT empresa_id INTO v_user_empresa_id
  FROM public.usuarios WHERE id = v_user_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;

  SELECT * INTO v_turno FROM public.turnos_caja WHERE id = p_turno_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El turno no existe'; END IF;

  IF v_turno.empresa_id <> v_user_empresa_id THEN
    -- superadmin con empresa nula podría inspeccionar; pero acá exigimos match.
    RAISE EXCEPTION 'El turno no pertenece a la empresa del usuario';
  END IF;

  -- Total efectivo de ventas NO anuladas (es lo que tiene que estar en caja).
  SELECT COALESCE(SUM(mpv.monto), 0)
  INTO v_total_efectivo_ventas
  FROM public.medios_pago_venta mpv
  JOIN public.ventas v ON v.id = mpv.venta_id
  WHERE v.turno_id = p_turno_id
    AND v.estado <> 'anulada'::venta_estado
    AND mpv.medio = 'efectivo'::medio_pago;

  v_total_teorico_efectivo := v_turno.base_inicial + v_total_efectivo_ventas;

  -- Totales por medio de pago (todos los medios, solo ventas no anuladas).
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'medio')), '[]'::jsonb)
  INTO v_totales_por_medio
  FROM (
    SELECT jsonb_build_object(
      'medio', mpv.medio::text,
      'monto', SUM(mpv.monto)::numeric(14,2),
      'cantidad', COUNT(*)
    ) AS t
    FROM public.medios_pago_venta mpv
    JOIN public.ventas v ON v.id = mpv.venta_id
    WHERE v.turno_id = p_turno_id
      AND v.estado <> 'anulada'::venta_estado
    GROUP BY mpv.medio
  ) sub;

  SELECT
    COUNT(*) FILTER (WHERE estado = 'cerrada'::venta_estado),
    COUNT(*) FILTER (WHERE estado = 'anulada'::venta_estado)
  INTO v_cantidad_ventas, v_cantidad_anulaciones
  FROM public.ventas
  WHERE turno_id = p_turno_id;

  RETURN jsonb_build_object(
    'turno_id', p_turno_id,
    'base_inicial', v_turno.base_inicial,
    'total_efectivo_ventas', v_total_efectivo_ventas,
    'total_teorico_efectivo', v_total_teorico_efectivo,
    'total_declarado', v_turno.total_declarado,
    'diferencia', v_turno.diferencia,
    'totales_por_medio_pago', v_totales_por_medio,
    'cantidad_ventas', v_cantidad_ventas,
    'cantidad_anulaciones', v_cantidad_anulaciones,
    'cerrado_at', v_turno.cerrado_at,
    'forzado_por_admin', v_turno.forzado_por_admin
  );
END;
$function$;

-- cerrar_turno
-- Cierra un turno abierto con conteo de efectivo declarado. Calcula la
-- diferencia (declarado − teórico) y la persiste. Devuelve jsonb con
-- el mismo shape que resumen_turno + datos del cierre.

CREATE OR REPLACE FUNCTION public.cerrar_turno(
  p_turno_id uuid,
  p_total_declarado numeric,
  p_nota_cierre text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_user_empresa_id uuid;
  v_turno public.turnos_caja;
  v_total_efectivo_ventas numeric := 0;
  v_total_teorico_efectivo numeric := 0;
  v_diferencia numeric := 0;
  v_resumen jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_total_declarado IS NULL OR p_total_declarado < 0 THEN
    RAISE EXCEPTION 'El total declarado debe ser un número mayor o igual a cero';
  END IF;

  SELECT email, empresa_id INTO v_user_email, v_user_empresa_id
  FROM public.usuarios WHERE id = v_user_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;

  SELECT * INTO v_turno FROM public.turnos_caja
  WHERE id = p_turno_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El turno no existe'; END IF;

  IF v_turno.empresa_id <> v_user_empresa_id THEN
    RAISE EXCEPTION 'El turno no pertenece a la empresa del usuario';
  END IF;

  IF v_turno.cerrado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  -- Total efectivo de ventas no anuladas asociadas al turno.
  SELECT COALESCE(SUM(mpv.monto), 0)
  INTO v_total_efectivo_ventas
  FROM public.medios_pago_venta mpv
  JOIN public.ventas v ON v.id = mpv.venta_id
  WHERE v.turno_id = p_turno_id
    AND v.estado <> 'anulada'::venta_estado
    AND mpv.medio = 'efectivo'::medio_pago;

  v_total_teorico_efectivo := v_turno.base_inicial + v_total_efectivo_ventas;
  v_diferencia := round(p_total_declarado - v_total_teorico_efectivo, 2);

  UPDATE public.turnos_caja
  SET cerrado_at = NOW(),
      usuario_cierre_id = v_user_id,
      total_declarado = p_total_declarado,
      diferencia = v_diferencia,
      nota_cierre = NULLIF(TRIM(COALESCE(p_nota_cierre, '')), '')
  WHERE id = p_turno_id
  RETURNING * INTO v_turno;

  -- Snapshot del resumen para devolver al caller.
  v_resumen := public.resumen_turno(p_turno_id);

  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot,
    entidad, entidad_id, accion, detalle, empresa_id
  ) VALUES (
    v_user_id, v_user_email,
    'turno_caja', p_turno_id, 'cerrar',
    jsonb_build_object(
      'base_inicial', v_turno.base_inicial,
      'total_efectivo_ventas', v_total_efectivo_ventas,
      'total_teorico_efectivo', v_total_teorico_efectivo,
      'total_declarado', p_total_declarado,
      'diferencia', v_diferencia,
      'nota_cierre', v_turno.nota_cierre
    ),
    v_user_empresa_id
  );

  RETURN v_resumen;
END;
$function$;

-- forzar_cierre_turno
-- Cierra un turno SIN total declarado (queda NULL). Solo admin/superadmin.
-- Marca forzado_por_admin=true + motivo. Útil cuando una cajera olvida
-- cerrar el turno y ya no está disponible.

CREATE OR REPLACE FUNCTION public.forzar_cierre_turno(
  p_turno_id uuid,
  p_motivo text
)
RETURNS public.turnos_caja
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_user_empresa_id uuid;
  v_turno public.turnos_caja;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede forzar el cierre de un turno';
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT email, empresa_id INTO v_user_email, v_user_empresa_id
  FROM public.usuarios WHERE id = v_user_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF;

  SELECT * INTO v_turno FROM public.turnos_caja
  WHERE id = p_turno_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El turno no existe'; END IF;

  -- superadmin sin empresa activa puede forzar cierre en cualquier empresa
  -- (paralelo a anular_venta).
  IF v_user_empresa_id IS NOT NULL
     AND v_turno.empresa_id <> v_user_empresa_id THEN
    RAISE EXCEPTION 'No tenés permisos sobre este turno';
  END IF;

  IF v_turno.cerrado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  UPDATE public.turnos_caja
  SET cerrado_at = NOW(),
      usuario_cierre_id = v_user_id,
      forzado_por_admin = true,
      motivo_forzado = trim(p_motivo)
  WHERE id = p_turno_id
  RETURNING * INTO v_turno;

  INSERT INTO public.audit_log (
    usuario_id, usuario_email_snapshot,
    entidad, entidad_id, accion, detalle, empresa_id
  ) VALUES (
    v_user_id, v_user_email,
    'turno_caja', p_turno_id, 'forzar_cierre',
    jsonb_build_object(
      'motivo', trim(p_motivo),
      'usuario_apertura_id', v_turno.usuario_apertura_id,
      'caja_id', v_turno.caja_id
    ),
    v_turno.empresa_id
  );

  RETURN v_turno;
END;
$function$;

-- obtener_turno_activo
-- Devuelve el turno abierto de una caja (o NULL). Validación implícita:
-- la caja debe pertenecer a la empresa del caller (sino retorna NULL).

CREATE OR REPLACE FUNCTION public.obtener_turno_activo(p_caja_id uuid)
RETURNS public.turnos_caja
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_empresa_id uuid;
  v_caja_empresa_id uuid;
  v_turno public.turnos_caja;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT empresa_id INTO v_user_empresa_id
  FROM public.usuarios WHERE id = auth.uid() AND activo = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT s.empresa_id INTO v_caja_empresa_id
  FROM public.cajas c
  JOIN public.sucursales s ON s.id = c.sucursal_id
  WHERE c.id = p_caja_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_user_empresa_id IS NOT NULL
     AND v_caja_empresa_id <> v_user_empresa_id THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_turno
  FROM public.turnos_caja
  WHERE caja_id = p_caja_id AND cerrado_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_turno;
END;
$function$;

-- ----------------------------------------------------------------------------
-- BLOQUE D — Modificar cerrar_venta y guardar_pedido para asociar turno
-- ----------------------------------------------------------------------------
-- Drop de la firma actual y re-CREATE con UN cambio puntual: bloque que
-- resuelve caja/sucursal/turno + 3 columnas en el INSERT a public.ventas.

DROP FUNCTION IF EXISTS public.cerrar_venta(
  uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric,
  text, text, boolean, numeric, text
);

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
  -- Nuevas variables para asociar la venta a caja + sucursal + turno.
  v_caja_id uuid;
  v_sucursal_id uuid;
  v_turno_id uuid;
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

  -- ============================================================
  -- NUEVO (migración 006): resolver caja + sucursal + turno activo.
  -- Para single-caja (Samu) usamos get_default_caja_id. Falla con mensaje
  -- claro si no hay caja configurada o no hay turno abierto.
  -- ============================================================
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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- ADAPTACIÓN A (de migration 003): variante_atributos jsonb.
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
    'total_cobrado', v_total_a_cobrar,
    'turno_id', v_turno_id
  );
END;
$function$;

-- guardar_pedido — mismo cambio puntual (caja/sucursal/turno).

DROP FUNCTION IF EXISTS public.guardar_pedido(
  uuid, uuid, text, jsonb, text, text
);

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
  -- Nuevas variables (migration 006).
  v_caja_id uuid;
  v_sucursal_id uuid;
  v_turno_id uuid;
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

  -- NUEVO (migration 006): caja + sucursal + turno activo.
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
    nombre_cliente_custom,
    caja_id, sucursal_id, turno_id
  ) VALUES (
    p_canal::canal_venta, p_usuario_id, p_cliente_id,
    v_subtotal, 0, v_subtotal,
    'guardada'::venta_estado, 'sin_factura'::tipo_factura, 0,
    p_nota_interna, NULL, v_empresa_id,
    v_nombre_custom_clean,
    v_caja_id, v_sucursal_id, v_turno_id
  )
  RETURNING id, numero INTO v_venta_id, v_venta_numero;

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
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'numero', v_venta_numero,
    'subtotal_neto', v_subtotal,
    'turno_id', v_turno_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- BLOQUE E — GRANTs finales
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.abrir_turno(uuid, numeric, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.abrir_turno(uuid, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cerrar_turno(uuid, numeric, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cerrar_turno(uuid, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.forzar_cierre_turno(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.forzar_cierre_turno(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.obtener_turno_activo(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.obtener_turno_activo(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resumen_turno(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resumen_turno(uuid) TO authenticated;

-- Recreamos GRANTs de cerrar_venta y guardar_pedido (firmas matchean las
-- viejas, pero el DROP+CREATE invalida los grants previos en algunas
-- versiones de Postgres — explícito por seguridad).

REVOKE EXECUTE ON FUNCTION public.cerrar_venta(
  uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric,
  text, text, boolean, numeric, text
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cerrar_venta(
  uuid, uuid, text, jsonb, jsonb, numeric, tipo_factura, numeric,
  text, text, boolean, numeric, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.guardar_pedido(
  uuid, uuid, text, jsonb, text, text
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardar_pedido(
  uuid, uuid, text, jsonb, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
