-- Cleanup: tabla venta_items legacy + fix funciones que la leían
-- ============================================================
--
-- Contexto: venta_items era el schema viejo, items_venta es la
-- tabla actual con datos reales. venta_items quedó vacía pero
-- 2 funciones SQL la seguían leyendo:
--   - anular_venta: bug crítico, no devuelve stock al anular
--     ventas cerradas (lee de tabla vacía)
--   - sa_exportar_datos: exporta data vacía (solo superadmin)
--
-- Esta migration:
-- 1. Reescribe anular_venta para leer de items_venta
-- 2. Reescribe sa_exportar_datos idem (2 bloques) + renombra
--    la key 'venta_items' del JSONB a 'items_venta'
-- 3. DROP policies RLS de venta_items
-- 4. DROP TABLE venta_items
--
-- Idempotente con IF EXISTS donde corresponde.


-- ============================================================
-- 1. Fix anular_venta (leer de items_venta, no venta_items)
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

  -- Validación de factura aprobada activa.
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

  -- Si estaba cerrada, revertir stock.
  -- FIX: leer de items_venta (tabla actual), no de venta_items (legacy vacía).
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


-- ============================================================
-- 2. Fix sa_exportar_datos (2 bloques + key del JSONB)
-- ============================================================

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

  -- Si vino empresa_id, validar que exista
  IF p_empresa_id IS NOT NULL THEN
    PERFORM 1 FROM public.empresas WHERE id = p_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Empresa no encontrada: %', p_empresa_id;
    END IF;
    v_alcance := 'empresa_unica';
  ELSE
    v_alcance := 'todas_las_empresas';
  END IF;

  -- Construir export según tabla y empresa
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
      -- FIX: leer de items_venta (tabla actual), no de venta_items (legacy).
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
      -- FIX: idem bloque "todas".
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

  -- Listar empresas tocadas (para audit detallado)
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

  -- Auditar con detalle de empresas tocadas
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


-- ============================================================
-- 3. DROP policies RLS y tabla venta_items
-- ============================================================

DROP POLICY IF EXISTS venta_items_insert ON public.venta_items;
DROP POLICY IF EXISTS venta_items_select ON public.venta_items;

DROP TABLE IF EXISTS public.venta_items;
