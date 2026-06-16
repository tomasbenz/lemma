-- Migración 034: hardening multi-tenant
-- Findings F-03, F-05, F-06, F-07, F-08, F-09, F-10
-- (docs/security/seguridad-multitenant-relevamiento.md)
-- F-04 (FORCE ROW LEVEL SECURITY) va en mig 035 por separado.
--
-- Orden deliberado: el bloque más riesgoso (F-09, cambio de tipo con guard)
-- va PRIMERO, así si el RAISE del guard dispara, abortamos todo (la migración
-- se aplica envuelta en BEGIN; ... COMMIT;) antes de tocar nada más.

-- ============================================================
-- F-09: audit_log.entidad_id text → uuid (con guard previo)
-- ============================================================
-- Verificado en el relevamiento: todos los writers de entidad_id usan UUIDs
-- (p_venta_id, p_variante_id, p_turno_id, p_pedido_id, p_usuario_id,
-- auth.uid(), v_var_id::text) o lo omiten (NULL). Las sa_exportar_datos /
-- sa_health_check NO escriben entidad_id (sus literales 'exportar_datos' /
-- 'health_check' van en la columna accion). El guard aborta si en prod
-- existiera alguna fila con entidad_id no-UUID.
DO $$
DECLARE
  v_invalid integer;
BEGIN
  SELECT COUNT(*) INTO v_invalid
  FROM public.audit_log
  WHERE entidad_id IS NOT NULL
    AND entidad_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'F-09 abortada: % filas en audit_log con entidad_id no-UUID', v_invalid;
  END IF;
END $$;

-- Postgres no permite ALTER TYPE en una columna referenciada por una vista,
-- aunque la vista la seleccione sin transformar. v_acciones_superadmin es la
-- única dependencia (verificado con pg_depend). La dropeamos, hacemos el
-- ALTER, y la recreamos idéntica con security_invoker=true (el atributo que
-- mig 033 le aplicó para cerrar F-02).
DROP VIEW IF EXISTS public.v_acciones_superadmin;

ALTER TABLE public.audit_log
  ALTER COLUMN entidad_id TYPE uuid USING entidad_id::uuid;

CREATE VIEW public.v_acciones_superadmin
  WITH (security_invoker = true) AS
SELECT
  al.id,
  al.created_at,
  al.entidad,
  al.entidad_id,
  al.accion,
  al.detalle,
  al.empresa_id,
  al.ip,
  al.motivo_superadmin,
  u.email AS superadmin_email
FROM public.audit_log al
LEFT JOIN public.usuarios u ON u.id = al.usuario_id
WHERE al.es_accion_superadmin = true;

-- ============================================================
-- F-03: DROP v_usuario_empresa_id
-- ============================================================
-- Vista muerta: el sweep de mig 033 confirmó cero consumers en src/
-- (sólo aparecía como referencedRelation de FKs en types/database.ts).
DROP VIEW IF EXISTS public.v_usuario_empresa_id;

-- ============================================================
-- F-05: Append-only en operaciones_masivas
-- ============================================================
-- Replica el patrón de operaciones_masivas_precio_detalle (mig023:58-75)
-- y de audit_log (mig003), que sí eran inmutables. La función sólo hace
-- RAISE (no toca tablas); SECURITY DEFINER + search_path pin por consistencia.
CREATE OR REPLACE FUNCTION public.prevent_operaciones_masivas_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'operaciones_masivas es append-only: % no permitido', TG_OP;
END $$;

CREATE TRIGGER prevent_operaciones_masivas_update
  BEFORE UPDATE ON public.operaciones_masivas
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operaciones_masivas_changes();

CREATE TRIGGER prevent_operaciones_masivas_delete
  BEFORE DELETE ON public.operaciones_masivas
  FOR EACH ROW EXECUTE FUNCTION public.prevent_operaciones_masivas_changes();

-- ============================================================
-- F-10: search_path pin en 3 SECURITY INVOKER (consistencia hardening)
-- ============================================================
-- Signatures exactas tomadas de la última definición (mig003):
--   reporte_ventas_agregado(p_desde timestamptz, p_hasta timestamptz)
--   ventas_totales_filtrados(timestamptz, timestamptz, text, text, uuid, uuid, integer, text)
--   validar_puntos_venta()  -- trigger, sin args
ALTER FUNCTION public.reporte_ventas_agregado(timestamptz, timestamptz)
  SET search_path TO 'public';
ALTER FUNCTION public.ventas_totales_filtrados(timestamptz, timestamptz, text, text, uuid, uuid, integer, text)
  SET search_path TO 'public';
ALTER FUNCTION public.validar_puntos_venta()
  SET search_path TO 'public';

-- ============================================================
-- F-06: validar tenant en persistir_cae_y_marcar_emitida
-- ============================================================
-- Última definición vigente: mig003:1752. Body íntegro reproducido; el único
-- cambio es el bloque de validación de tenant agregado tras el guard de auth.
-- El `auth.uid() IS NOT NULL AND ...` es deliberado: si alguna vez se llamara
-- con service role (auth.uid()=NULL) saltearía el chequeo. Hoy el único caller
-- (emitir-factura-afip.ts) usa el cliente RLS con sesión real y pasa
-- p_empresa_id = user.empresa_id, así que la validación nunca rechaza un
-- llamado legítimo.
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

  -- F-06: el empresa pasado por el cliente debe coincidir con el del caller.
  IF auth.uid() IS NOT NULL
     AND p_empresa_id IS DISTINCT FROM
         (SELECT empresa_id FROM public.usuarios WHERE id = auth.uid())
  THEN
    RAISE EXCEPTION 'p_empresa_id (%) no coincide con la empresa del caller', p_empresa_id;
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

-- ============================================================
-- F-07: empresa_id en INSERT de registrar_login
-- ============================================================
-- Última definición vigente: mig003:2271. Body íntegro reproducido; cambios:
-- el UPDATE ahora devuelve también empresa_id, y el INSERT a audit_log setea
-- empresa_id (antes quedaba NULL, dejando los logins invisibles a la policy
-- audit_log_select). Puede ser NULL para usuarios sin empresa asignada todavía
-- (handle_new_user los deja NULL por diseño, F-12) — aceptable.
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
  v_empresa_id uuid;
begin
  update public.usuarios
  set ultimo_login_at = now(),
      ultimo_login_ip = p_ip,
      ultimo_login_user_agent = p_user_agent
  where id = auth.uid()
  returning email, empresa_id into v_email, v_empresa_id;

  insert into public.audit_log (
    usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, ip, user_agent, empresa_id
  ) values (
    auth.uid(), v_email, 'auth', auth.uid(), 'login', p_ip, p_user_agent, v_empresa_id
  );
end;
$function$;

-- ============================================================
-- F-08: doble WHERE (defensa en profundidad) en UPDATEs de turnos y bulk
-- ============================================================
-- cerrar_turno: última definición mig006:278. El pre-check ya raisea si el
-- turno no es del caller; agregamos AND empresa_id = v_user_empresa_id al
-- UPDATE para el patrón doble-WHERE de CLAUDE.md.
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
    AND empresa_id = v_user_empresa_id
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

-- forzar_cierre_turno: última definición mig006:372. OJO: esta función deja
-- pasar al superadmin sin empresa (v_user_empresa_id IS NULL) para cerrar
-- turnos de cualquier empresa. Por eso el doble-WHERE acá scopea por
-- v_turno.empresa_id (la empresa del recurso ya lockeado vía FOR UPDATE),
-- NO por v_user_empresa_id — usar v_user_empresa_id rompería el bypass de
-- superadmin (WHERE empresa_id = NULL no matchea nada).
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
    AND empresa_id = v_turno.empresa_id
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

-- importar_productos_bulk: última definición mig016:289. Body íntegro
-- reproducido; el único cambio es AND empresa_id = v_empresa_id en el UPDATE
-- de la rama "producto ya existe" (antes WHERE id = v_producto_id a secas,
-- apoyado sólo en el SELECT scopeado previo).
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
  v_advertencias jsonb := '[]'::jsonb;
  v_skus_vistos text[] := ARRAY[]::text[];
  v_sku text;
  v_nombre text;
  v_marca text;
  v_cat_nombre text;
  v_marca_id uuid;
  v_categoria_id uuid;
  v_precio numeric;
  v_costo numeric;
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
    BEGIN
      v_precio := COALESCE((v_item->>'precio_neto')::numeric, -1);
    EXCEPTION WHEN OTHERS THEN
      v_precio := -1;
    END;
    -- costo opcional: no numérico => NULL (se trata como ausente).
    BEGIN
      v_costo := (v_item->>'costo')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_costo := NULL;
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
    IF v_marca IS NOT NULL AND length(v_marca) > 100 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Marca mayor a 100 caracteres');
      CONTINUE;
    END IF;
    IF v_precio < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Precio inválido o no numérico');
      CONTINUE;
    END IF;
    IF v_costo IS NOT NULL AND v_costo < 0 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Costo negativo');
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
    v_cat_nombre := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    v_precio := (v_item->>'precio_neto')::numeric;
    -- costo opcional: NULL si ausente/no numérico (no se toca en UPDATE).
    BEGIN
      v_costo := (v_item->>'costo')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_costo := NULL;
    END;

    -- Resolver marca: se crea si no existe.
    v_marca_id := NULL;
    IF v_marca IS NOT NULL THEN
      INSERT INTO public.marcas (empresa_id, nombre, nombre_normalizado)
      VALUES (v_empresa_id, v_marca, public.normalizar_busqueda(v_marca))
      ON CONFLICT (empresa_id, nombre_normalizado)
        DO UPDATE SET nombre = marcas.nombre
      RETURNING id INTO v_marca_id;
    END IF;

    -- Resolver categoría: solo match, NO se crea (curated).
    v_categoria_id := NULL;
    IF v_cat_nombre IS NOT NULL THEN
      SELECT id INTO v_categoria_id
      FROM public.catalogo_categorias
      WHERE empresa_id = v_empresa_id
        AND nombre_normalizado = public.normalizar_busqueda(v_cat_nombre);
      IF NOT FOUND THEN
        v_advertencias := v_advertencias || jsonb_build_object(
          'sku', v_sku,
          'motivo', 'Categoría "' || v_cat_nombre || '" no existe (se ignoró)'
        );
      END IF;
    END IF;

    SELECT id INTO v_producto_id
    FROM public.productos
    WHERE sku_base = v_sku AND empresa_id = v_empresa_id
    LIMIT 1;

    v_existe := FOUND;

    IF v_existe THEN
      UPDATE public.productos
      SET nombre = v_nombre,
          marca_id = v_marca_id,
          categoria_id = v_categoria_id,
          precio_neto = v_precio,
          -- costo: si vino numérico se setea; si no, se preserva el actual.
          costo = COALESCE(v_costo, costo),
          updated_at = NOW()
      WHERE id = v_producto_id
        AND empresa_id = v_empresa_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      INSERT INTO public.productos (
        sku_base, nombre, marca_id, categoria_id, precio_neto, costo,
        empresa_id, activo, track_stock
      ) VALUES (
        v_sku, v_nombre, v_marca_id, v_categoria_id, v_precio, v_costo,
        v_empresa_id, true, true
      )
      RETURNING id INTO v_producto_id;

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
    'actualizados', v_actualizados,
    'advertencias', v_advertencias
  );
END;
$function$;
