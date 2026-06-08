-- ============================================================================
-- 00000000000029_combos_triggers_y_vista.sql
-- ----------------------------------------------------------------------------
-- FEATURE COMBOS — Migración B de 3 (la más crítica: precio/costo/stock).
--
-- Implementa:
--   D2  precio_neto y costo del combo como columnas DENORMALIZADAS mantenidas
--       por triggers. Los ~30 lectores de productos.precio_neto/costo siguen
--       funcionando sin cambios.
--   D5  función stock_combo(combo_id) + reescritura de productos_con_stock_total
--       para que los combos usen stock derivado en vez de SUM(variantes.stock).
--   D3  trigger BEFORE UPDATE OF activo que bloquea desactivar un producto que
--       es componente de un combo activo + pre-check en eliminar_producto.
--
-- Riesgos resueltos (relevamiento previo):
--   R1 (clobber): T1 fuerza precio_neto/costo del combo al valor derivado en
--      CUALQUIER UPDATE que toque esas columnas o el descuento. Defense in depth:
--      un aumento masivo que por error incluya el id de un combo no lo corrompe.
--   R3 (override): el precio teórico usa productos.precio_neto del componente
--      (decisión #7). Si la variante del componente usa precio_neto_override, se
--      ignora; la UI lo advertirá (commit de UI posterior, no acá).
--   R4 (costo NULL parcial): el costo del combo es NULL si algún componente
--      tiene costo NULL (margen "desconocido", igual que productos sin costo).
--
-- Recursión: verificada y acotada. La recompute UPDATEa el combo; eso dispara
-- T1 (recomputa el mismo valor, idempotente) y T3 (busca combos que contengan
-- al combo como componente → ninguno por anti-anidación de Migr A → no-op).
--
-- IMPORTANTE: NO se aplica automáticamente. Tomás la aplica a mano en prod.
-- Después correr `npm run db:types` antes del próximo commit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Funciones de cálculo
-- ----------------------------------------------------------------------------

-- precio + costo del combo a partir de sus componentes y su descuento.
-- STABLE, sin SECURITY DEFINER → respeta RLS (lee solo filas de la empresa).
CREATE OR REPLACE FUNCTION public.combo_precio_costo(
  p_combo_id uuid,
  OUT precio numeric,
  OUT costo numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_precio_teorico numeric;
  v_descuento numeric;
  v_todos_costo boolean;
  v_costo_sum numeric;
BEGIN
  SELECT
    COALESCE(SUM(p.precio_neto * cc.cantidad), 0),
    bool_and(p.costo IS NOT NULL),
    SUM(p.costo * cc.cantidad)
  INTO v_precio_teorico, v_todos_costo, v_costo_sum
  FROM public.combo_componentes cc
  JOIN public.productos p ON p.id = cc.componente_producto_id
  WHERE cc.combo_id = p_combo_id;

  SELECT descuento_combo_pct INTO v_descuento
  FROM public.productos WHERE id = p_combo_id;

  precio := round(v_precio_teorico * (1 - COALESCE(v_descuento, 0) / 100.0), 2);
  -- bool_and de conjunto vacío = NULL → COALESCE false → costo NULL (combo sin
  -- componentes). Si algún componente tiene costo NULL → bool_and false → NULL.
  costo := CASE WHEN COALESCE(v_todos_costo, false) THEN v_costo_sum ELSE NULL END;
END;
$function$;

-- stock derivado del combo = floor(min(stock_componente / cantidad)).
CREATE OR REPLACE FUNCTION public.stock_combo(p_combo_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(MIN(floor(v.stock::numeric / cc.cantidad))::bigint, 0)
  FROM public.combo_componentes cc
  JOIN public.variantes v ON v.id = cc.componente_variante_id
  WHERE cc.combo_id = p_combo_id;
$function$;

-- Persiste precio_neto/costo derivados en la fila del combo.
-- El `AND es_combo = true` protege el edge de cascada: si el combo ya fue
-- borrado (o dejó de ser combo), el UPDATE matchea 0 filas → no-op.
CREATE OR REPLACE FUNCTION public.recomputar_combo(p_combo_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_precio numeric;
  v_costo numeric;
BEGIN
  SELECT precio, costo INTO v_precio, v_costo
  FROM public.combo_precio_costo(p_combo_id);

  UPDATE public.productos
  SET precio_neto = v_precio, costo = v_costo
  WHERE id = p_combo_id AND es_combo = true;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) T1 — Clobber-guard + recompute por cambio de descuento
--    BEFORE UPDATE OF precio_neto, costo, descuento_combo_pct (solo combos).
--    Fuerza precio_neto/costo al valor derivado in-place (no emite UPDATE →
--    sin recursión). Cubre: (a) cambio de descuento, (b) cualquier intento de
--    escribir un precio "manual" a un combo → se sobrescribe con el derivado.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combo_clobber_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_precio numeric;
  v_costo numeric;
BEGIN
  SELECT precio, costo INTO v_precio, v_costo
  FROM public.combo_precio_costo(NEW.id);
  NEW.precio_neto := v_precio;
  NEW.costo := v_costo;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS combo_clobber_guard_trg ON public.productos;
CREATE TRIGGER combo_clobber_guard_trg
  BEFORE UPDATE OF precio_neto, costo, descuento_combo_pct ON public.productos
  FOR EACH ROW
  WHEN (NEW.es_combo = true)
  EXECUTE FUNCTION public.combo_clobber_guard();

-- ----------------------------------------------------------------------------
-- 3) T2 — Recompute al cambiar los componentes de un combo
--    AFTER INSERT/UPDATE/DELETE en combo_componentes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combo_componentes_recompute()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recomputar_combo(COALESCE(NEW.combo_id, OLD.combo_id));
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS combo_componentes_recompute_trg ON public.combo_componentes;
CREATE TRIGGER combo_componentes_recompute_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.combo_componentes
  FOR EACH ROW
  EXECUTE FUNCTION public.combo_componentes_recompute();

-- ----------------------------------------------------------------------------
-- 4) T3 — Bulk-safe: recompute de combos cuando cambian precios/costos de
--    sus componentes. STATEMENT-level con transition tables → un aumento masivo
--    de miles de productos recomputa cada combo afectado UNA sola vez.
--
--    NOTA Postgres: NO se permite `REFERENCING ... TABLE` junto a `UPDATE OF
--    <cols>` ("transition tables cannot be specified for triggers with column
--    lists"). Por eso el trigger se dispara en TODO UPDATE de productos y el
--    filtro de precio/costo se hace adentro comparando NEW vs OLD (early-exit
--    rápido si ningún precio_neto/costo cambió → el caso común no paga costo).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_combos_de_componentes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_combo_id uuid;
BEGIN
  -- Early-exit: si en NINGUNA fila cambió precio_neto ni costo, no hay nada que
  -- recomputar (el trigger corre en todo UPDATE de productos: nombre, stock vía
  -- variantes no, activo, etc.). Comparación NEW vs OLD por id.
  IF NOT EXISTS (
    SELECT 1
    FROM nuevos n
    JOIN viejos vj ON vj.id = n.id
    WHERE n.precio_neto IS DISTINCT FROM vj.precio_neto
       OR n.costo       IS DISTINCT FROM vj.costo
  ) THEN
    RETURN NULL;
  END IF;

  -- Combos DISTINCT que contienen como componente algún producto cuyo
  -- precio_neto o costo cambió en este statement.
  FOR v_combo_id IN
    SELECT DISTINCT cc.combo_id
    FROM nuevos n
    JOIN viejos vj ON vj.id = n.id
    JOIN public.combo_componentes cc ON cc.componente_producto_id = n.id
    WHERE n.precio_neto IS DISTINCT FROM vj.precio_neto
       OR n.costo       IS DISTINCT FROM vj.costo
  LOOP
    PERFORM public.recomputar_combo(v_combo_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS productos_recompute_combos_trg ON public.productos;
CREATE TRIGGER productos_recompute_combos_trg
  AFTER UPDATE ON public.productos
  REFERENCING NEW TABLE AS nuevos OLD TABLE AS viejos
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.recompute_combos_de_componentes();

-- ----------------------------------------------------------------------------
-- 5) T4 — Bloqueo de desactivación de componentes (D3)
--    BEFORE UPDATE OF activo. Si el producto pasa a inactivo y es componente
--    de un combo activo → RAISE con el nombre del combo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bloquear_desactivar_componente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_combo_nombre text;
BEGIN
  IF NEW.activo = false AND OLD.activo = true THEN
    SELECT combo.nombre INTO v_combo_nombre
    FROM public.combo_componentes cc
    JOIN public.productos combo ON combo.id = cc.combo_id
    WHERE cc.componente_producto_id = NEW.id
      AND combo.es_combo = true
      AND combo.activo = true
    LIMIT 1;

    IF v_combo_nombre IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede desactivar este producto porque es componente del combo "%". Eliminá o desarmá el combo primero.', v_combo_nombre;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS productos_bloquear_desactivar_componente_trg ON public.productos;
CREATE TRIGGER productos_bloquear_desactivar_componente_trg
  BEFORE UPDATE OF activo ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.bloquear_desactivar_componente();

-- ----------------------------------------------------------------------------
-- 6) Reescritura de productos_con_stock_total (combos usan stock_combo())
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.productos_con_stock_total AS
SELECT
  p.id,
  p.empresa_id,
  p.sku_base,
  p.nombre,
  p.marca_id,
  m.nombre AS marca_nombre,
  p.categoria_id,
  c.nombre AS categoria_nombre,
  p.descripcion_corta,
  p.precio_neto,
  p.imagen_url,
  p.track_stock,
  p.activo,
  p.created_at,
  p.es_combo,
  p.descuento_combo_pct,
  CASE
    WHEN p.es_combo THEN public.stock_combo(p.id)
    ELSE COALESCE((
      SELECT SUM(v.stock)::bigint
      FROM public.variantes v
      WHERE v.producto_id = p.id AND v.activa
    ), 0)
  END AS stock_total,
  CASE
    WHEN p.es_combo THEN public.stock_combo(p.id) <= 5
    ELSE COALESCE((
      SELECT SUM(v.stock)::bigint
      FROM public.variantes v
      WHERE v.producto_id = p.id AND v.activa
    ), 0) <= 5
  END AS tiene_stock_bajo
FROM public.productos p
LEFT JOIN public.marcas m ON m.id = p.marca_id
LEFT JOIN public.catalogo_categorias c ON c.id = p.categoria_id;

-- CRÍTICO: re-aplicar security_invoker con `true` literal (NO `on`). El
-- CREATE OR REPLACE no garantiza preservar la reloption → la seteamos explícita.
ALTER VIEW public.productos_con_stock_total SET (security_invoker = true);

DO $$
DECLARE v_opts text;
BEGIN
  SELECT array_to_string(reloptions, ',') INTO v_opts
  FROM pg_class WHERE relname = 'productos_con_stock_total'
    AND relnamespace = 'public'::regnamespace;
  IF v_opts IS NULL OR v_opts NOT LIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'productos_con_stock_total NO tiene security_invoker=true (got: %)', COALESCE(v_opts, 'NULL');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7) eliminar_producto: pre-check D3 (es componente de un combo activo).
--    Reproduce el cuerpo de mig 026 + un sub-bloque ANTES del conteo de ventas.
--    Devuelve {ok:false, error} (shape nuevo). La action TS eliminarProducto
--    debe actualizarse (próximo commit) para chequear `result.ok === false`.
--    Nota: en prod todavía no hay combos (no hay UI), así que este path no se
--    dispara hasta que existan combos → sin estado intermedio roto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eliminar_producto(
  p_usuario_id uuid,
  p_id uuid,
  p_razon text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_razon text;
  v_snapshot jsonb;
  v_count_ventas integer := 0;
  v_modo text;
  v_operacion_id uuid;
  v_combo_nombre text;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede eliminar productos';
  END IF;

  -- ===== Empresa + email (re-derivados, no se confía en el cliente) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación de razón =====
  v_razon := TRIM(COALESCE(p_razon, ''));
  IF length(v_razon) = 0 THEN
    RAISE EXCEPTION 'La razón es obligatoria';
  END IF;
  IF length(v_razon) > 200 THEN
    RAISE EXCEPTION 'La razón no puede superar 200 caracteres';
  END IF;

  -- ===== Snapshot del producto (ANTES de mutar) + pre-check pertenencia =====
  SELECT jsonb_build_object(
    'nombre', p.nombre,
    'sku_base', p.sku_base,
    'precio_neto', p.precio_neto,
    'costo', p.costo,
    'activo_antes', p.activo,
    'marca_nombre', m.nombre,
    'categoria_nombre', c.nombre
  )
  INTO v_snapshot
  FROM public.productos p
  LEFT JOIN public.marcas m ON m.id = p.marca_id
  LEFT JOIN public.catalogo_categorias c ON c.id = p.categoria_id
  WHERE p.id = p_id AND p.empresa_id = v_empresa_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'El producto no existe';
  END IF;

  -- ===== Pre-check D3: ¿es componente de un combo activo? =====
  -- Se corta acá con mensaje claro. Si no, el DELETE chocaría con la FK RESTRICT
  -- de combo_componentes → caería al EXCEPTION → soft delete → el trigger T4
  -- lanzaría un error no manejado por el bloque (solo captura FK violation).
  SELECT combo.nombre INTO v_combo_nombre
  FROM public.combo_componentes cc
  JOIN public.productos combo ON combo.id = cc.combo_id
  WHERE cc.componente_producto_id = p_id
    AND combo.empresa_id = v_empresa_id
    AND combo.es_combo = true
    AND combo.activo = true
  LIMIT 1;

  IF v_combo_nombre IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No se puede eliminar este producto porque es componente del combo "' || v_combo_nombre || '". Eliminá o desarmá el combo primero.'
    );
  END IF;

  -- ===== Conteo de ventas (para el mensaje, no para la decisión final) =====
  SELECT COUNT(DISTINCT iv.venta_id) INTO v_count_ventas
  FROM public.items_venta iv
  JOIN public.variantes v ON v.id = iv.variante_id
  WHERE v.producto_id = p_id AND iv.empresa_id = v_empresa_id;

  -- ===== Decisión hard/soft con RESTRICT como red de seguridad =====
  IF v_count_ventas = 0 THEN
    BEGIN
      DELETE FROM public.productos
      WHERE id = p_id AND empresa_id = v_empresa_id;
      v_modo := 'hard';
    EXCEPTION
      WHEN foreign_key_violation THEN
        UPDATE public.productos
        SET activo = false
        WHERE id = p_id AND empresa_id = v_empresa_id;
        v_modo := 'soft';
        SELECT COUNT(DISTINCT iv.venta_id) INTO v_count_ventas
        FROM public.items_venta iv
        JOIN public.variantes v ON v.id = iv.variante_id
        WHERE v.producto_id = p_id AND iv.empresa_id = v_empresa_id;
    END;
  ELSE
    UPDATE public.productos
    SET activo = false
    WHERE id = p_id AND empresa_id = v_empresa_id;
    v_modo := 'soft';
  END IF;

  -- ===== Auditoría (misma tx) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, ids_afectados
  ) VALUES (
    v_empresa_id,
    p_usuario_id,
    COALESCE(v_usuario_email, 'desconocido'),
    'eliminar_producto',
    jsonb_build_object(
      'razon', v_razon,
      'modo', v_modo,
      'ventas', v_count_ventas,
      'snapshot', v_snapshot
    ),
    1,
    1,
    jsonb_build_array(p_id)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'modo', v_modo,
    'ventas', v_count_ventas,
    'operacion_id', v_operacion_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.eliminar_producto(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_producto(uuid, uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8) NOTA para el próximo commit TS (NO es parte de esta migración SQL):
--    - eliminar-producto.ts: detectar `result.ok === false` y surfacear
--      `result.error` (hoy la action asume siempre el shape de éxito).
--    - cambiar-estado.ts: opcional pre-check del caso "componente de combo
--      activo" para UX prolija. Mientras tanto, el trigger T4 bloquea el UPDATE
--      con RAISE EXCEPTION y la action surfacea error.message (legible, crudo).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 9) Smoke test de la migración
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_funcs integer;
  v_triggers integer;
BEGIN
  SELECT count(*) INTO v_funcs
  FROM pg_proc
  WHERE proname IN ('combo_precio_costo', 'stock_combo', 'recomputar_combo',
                    'combo_clobber_guard', 'combo_componentes_recompute',
                    'recompute_combos_de_componentes', 'bloquear_desactivar_componente')
    AND pronamespace = 'public'::regnamespace;
  IF v_funcs < 7 THEN
    RAISE EXCEPTION 'Faltan funciones de combos (encontradas: %)', v_funcs;
  END IF;

  SELECT count(DISTINCT trigger_name) INTO v_triggers
  FROM information_schema.triggers
  WHERE event_object_table IN ('productos', 'combo_componentes')
    AND trigger_name IN ('combo_clobber_guard_trg', 'combo_componentes_recompute_trg',
                         'productos_recompute_combos_trg',
                         'productos_bloquear_desactivar_componente_trg');
  IF v_triggers < 4 THEN
    RAISE EXCEPTION 'Faltan triggers de combos (encontrados: %)', v_triggers;
  END IF;

  RAISE NOTICE 'OK: combos triggers + vista (mig 029) aplicados.';
END;
$$;
