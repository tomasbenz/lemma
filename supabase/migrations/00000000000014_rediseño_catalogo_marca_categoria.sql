-- ============================================================================
-- 00000000000014_rediseño_catalogo_marca_categoria.sql
-- ----------------------------------------------------------------------------
-- Rediseño del catálogo: separar MARCA de CATEGORÍA real.
--
-- BUG HISTÓRICO (confirmado vía SQL en prod):
--   * productos.categoria (text libre) en realidad almacenaba MARCAS
--     (Kangaro, Pilot, Footy, Sakura, Liquid Paper, ...). 152 valores distintos.
--   * catalogo_categorias ya estaba poblada con CATEGORÍAS REALES (Cuadernos,
--     Lápices y Lapiceras, Carpetas y Folios, Pinturas y Arte, ...) y
--     categoria_atributos cuelga de ella correctamente — pero NO había enlace
--     entre productos y catalogo_categorias.
--
-- PLAN (rediseño base; la acción "Aumento por proveedor" va en otra fase):
--   A) Crear tabla `marcas` NUEVA (misma forma que catalogo_categorias).
--   B) Poblarla con los DISTINCT de productos.categoria actual.
--   C) productos.marca_id  uuid FK -> marcas               (backfill)
--      productos.categoria_id uuid FK -> catalogo_categorias (queda NULL;
--      Samu asigna gradualmente — las categorías son curated).
--   D) Backfill marca_id (match por nombre_normalizado, robusto a may/min/tildes).
--   E/F) Dropear la vieja productos.categoria (text libre, mal usado) y sus
--      dependencias (vista + columna generada + índice GIN).
--   G) Recrear busqueda_normalizada como columna NORMAL mantenida por trigger
--      BEFORE INSERT/UPDATE (no GENERATED, no mirror desnormalizado). Único caso
--      no cubierto: rename de marca no propaga (rarísimo; se re-toca el producto).
--   H) Recrear vista productos_con_stock_total con marca/categoria por JOIN.
--   I) productos_bulk_update: 'cambiar_categoria' (texto) -> 'cambiar_marca'
--      (marca_id) + nueva 'cambiar_categoria' (categoria_id).
--   J) productos_bulk_import: columna 'marca' (resuelve/crea marca_id) +
--      'categoria' (resuelve categoria_id contra catalogo_categorias; si no
--      existe se IGNORA con advertencia, NO se crea — son curated).
--   * categoria_atributos NO se toca (sigue colgando de catalogo_categorias).
--
-- NUNCA aplicar automáticamente. Tomás audita y corre EN HORA MUERTA (el backfill
-- toca ~6.658 filas + recrea el índice GIN; estimado 5-30 s).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 14.A  Tabla marcas (misma estructura/políticas que catalogo_categorias)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marcas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre_normalizado)
);

CREATE INDEX IF NOT EXISTS marcas_empresa_idx ON public.marcas(empresa_id);

DROP TRIGGER IF EXISTS marcas_set_updated_at ON public.marcas;
CREATE TRIGGER marcas_set_updated_at BEFORE UPDATE ON public.marcas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marcas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marcas_select ON public.marcas;
CREATE POLICY marcas_select ON public.marcas FOR SELECT
  USING (public.es_superadmin() OR empresa_id = public.get_empresa_id());

DROP POLICY IF EXISTS marcas_write ON public.marcas;
CREATE POLICY marcas_write ON public.marcas FOR ALL
  USING (empresa_id = public.get_empresa_id())
  WITH CHECK (empresa_id = public.get_empresa_id());

-- ----------------------------------------------------------------------------
-- 14.B  Poblar marcas desde productos.categoria (DISTINCT por nombre normalizado)
-- ----------------------------------------------------------------------------
-- DISTINCT ON (empresa_id, normalizado) para no violar el UNIQUE si dos valores
-- de texto distintos colapsan al mismo normalizado (ej "Pilot" / "PILOT").
-- Se conserva como `nombre` la primera variante alfabética.

INSERT INTO public.marcas (empresa_id, nombre, nombre_normalizado, orden, activo)
SELECT DISTINCT ON (p.empresa_id, public.normalizar_busqueda(p.categoria))
  p.empresa_id,
  TRIM(p.categoria),
  public.normalizar_busqueda(p.categoria),
  0,
  true
FROM public.productos p
WHERE p.categoria IS NOT NULL AND TRIM(p.categoria) <> ''
ORDER BY p.empresa_id, public.normalizar_busqueda(p.categoria), TRIM(p.categoria)
ON CONFLICT (empresa_id, nombre_normalizado) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 14.C  Columnas FK en productos
-- ----------------------------------------------------------------------------

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS marca_id uuid REFERENCES public.marcas(id) ON DELETE SET NULL;
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.catalogo_categorias(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS productos_marca_idx ON public.productos(marca_id);
CREATE INDEX IF NOT EXISTS productos_categoria_idx ON public.productos(categoria_id);

-- ----------------------------------------------------------------------------
-- 14.D  Backfill marca_id (match por nombre normalizado — robusto a casing/tildes)
--       NO se backfillea categoria_id: queda NULL, Samu asigna gradualmente.
-- ----------------------------------------------------------------------------

UPDATE public.productos p
SET marca_id = m.id
FROM public.marcas m
WHERE m.empresa_id = p.empresa_id
  AND m.nombre_normalizado = public.normalizar_busqueda(p.categoria)
  AND p.categoria IS NOT NULL
  AND TRIM(p.categoria) <> '';

-- ----------------------------------------------------------------------------
-- 14.E  Dropear dependencias de productos.categoria
-- ----------------------------------------------------------------------------
-- Orden obligatorio: el índice y la columna generada dependen de
-- busqueda_normalizada/categoria; la vista referencia p.categoria.
-- Sin CASCADE a propósito: si en prod hay un dependiente no versionado, que
-- falle ruidosamente en vez de dropear algo silenciosamente.

DROP INDEX IF EXISTS public.productos_busqueda_idx;
ALTER TABLE public.productos DROP COLUMN IF EXISTS busqueda_normalizada;
DROP VIEW IF EXISTS public.productos_con_stock_total;

-- ----------------------------------------------------------------------------
-- 14.F  Dropear la vieja categoria (text libre)
-- ----------------------------------------------------------------------------

ALTER TABLE public.productos DROP COLUMN IF EXISTS categoria;

-- ----------------------------------------------------------------------------
-- 14.G  Recrear busqueda_normalizada como columna NORMAL + trigger
-- ----------------------------------------------------------------------------

ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS busqueda_normalizada text;

CREATE OR REPLACE FUNCTION public.actualizar_busqueda_normalizada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_marca_nombre text;
  v_categoria_nombre text;
BEGIN
  IF NEW.marca_id IS NOT NULL THEN
    SELECT nombre INTO v_marca_nombre FROM public.marcas WHERE id = NEW.marca_id;
  END IF;
  IF NEW.categoria_id IS NOT NULL THEN
    SELECT nombre INTO v_categoria_nombre FROM public.catalogo_categorias WHERE id = NEW.categoria_id;
  END IF;
  NEW.busqueda_normalizada := public.normalizar_busqueda(
    NEW.nombre || ' ' ||
    COALESCE(NEW.sku_base, '') || ' ' ||
    COALESCE(v_marca_nombre, '') || ' ' ||
    COALESCE(v_categoria_nombre, '')
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS productos_busqueda_normalizada_trigger ON public.productos;
CREATE TRIGGER productos_busqueda_normalizada_trigger
  BEFORE INSERT OR UPDATE OF nombre, sku_base, marca_id, categoria_id ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_busqueda_normalizada();

-- Backfill explícito (set-based, una pasada). No usamos el trigger porque
-- escribir busqueda_normalizada no dispara el trigger (no está en su lista de
-- columnas), así que lo calculamos directamente.
UPDATE public.productos p
SET busqueda_normalizada = public.normalizar_busqueda(
  p.nombre || ' ' ||
  COALESCE(p.sku_base, '') || ' ' ||
  COALESCE((SELECT nombre FROM public.marcas WHERE id = p.marca_id), '') || ' ' ||
  COALESCE((SELECT nombre FROM public.catalogo_categorias WHERE id = p.categoria_id), '')
);

CREATE INDEX IF NOT EXISTS productos_busqueda_idx
  ON public.productos USING GIN (busqueda_normalizada gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 14.H  Recrear vista productos_con_stock_total con marca/categoria por JOIN
-- ----------------------------------------------------------------------------

CREATE VIEW public.productos_con_stock_total AS
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
  COALESCE((
    SELECT SUM(v.stock)::bigint
    FROM public.variantes v
    WHERE v.producto_id = p.id AND v.activa
  ), 0) AS stock_total,
  COALESCE((
    SELECT SUM(v.stock)::bigint
    FROM public.variantes v
    WHERE v.producto_id = p.id AND v.activa
  ), 0) <= 5 AS tiene_stock_bajo
FROM public.productos p
LEFT JOIN public.marcas m ON m.id = p.marca_id
LEFT JOIN public.catalogo_categorias c ON c.id = p.categoria_id;

-- ----------------------------------------------------------------------------
-- 14.I  productos_bulk_update — 'cambiar_marca' + nueva 'cambiar_categoria'
--       (replica el cuerpo vigente de la migración 010 con las 2 acciones nuevas)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_update(
  p_usuario_id uuid,
  p_accion text,
  p_ids uuid[],
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_ids uuid[];
  v_total integer;
  v_validos uuid[];
  v_omitidos jsonb;
  v_afectados integer := 0;
  v_ids_afectados jsonb := '[]'::jsonb;
  v_operacion_id uuid;
  -- params tipados
  v_pct numeric;
  v_precio numeric;
  v_marca_id uuid;
  v_categoria_id uuid;
  v_activo boolean;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede modificar productos en masa';
  END IF;

  -- ===== Empresa (re-derivada, no se confía en el cliente) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación de ids (dedup + cap) =====
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay productos para modificar';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT unnest(p_ids));
  v_total := array_length(v_ids, 1);

  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 productos por operación (recibidos: %)', v_total;
  END IF;

  -- ===== Validación de acción + params (batch-level => RAISE) =====
  IF p_accion = 'precio_pct' THEN
    IF jsonb_typeof(p_params->'pct') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'precio_pct requiere params.pct numérico';
    END IF;
    v_pct := (p_params->>'pct')::numeric;
    IF v_pct < -100 THEN
      RAISE EXCEPTION 'El porcentaje no puede ser menor a -100 (descuento máximo 100%%)';
    END IF;

  ELSIF p_accion = 'precio_fijo' THEN
    IF jsonb_typeof(p_params->'precio') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'precio_fijo requiere params.precio numérico';
    END IF;
    v_precio := (p_params->>'precio')::numeric;
    IF v_precio <= 0 THEN
      RAISE EXCEPTION 'El precio fijo debe ser mayor a 0';
    END IF;

  ELSIF p_accion = 'cambiar_marca' THEN
    -- marca_id ausente/null/'' => NULL (sin marca). Si viene, debe existir
    -- en marcas de la empresa.
    IF jsonb_typeof(p_params->'marca_id') = 'string' THEN
      v_marca_id := NULLIF(TRIM(p_params->>'marca_id'), '')::uuid;
    ELSE
      v_marca_id := NULL;
    END IF;
    IF v_marca_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.marcas WHERE id = v_marca_id AND empresa_id = v_empresa_id
    ) THEN
      RAISE EXCEPTION 'La marca no existe';
    END IF;

  ELSIF p_accion = 'cambiar_categoria' THEN
    -- categoria_id ausente/null/'' => NULL (sin categoría). Si viene, debe
    -- existir en catalogo_categorias de la empresa.
    IF jsonb_typeof(p_params->'categoria_id') = 'string' THEN
      v_categoria_id := NULLIF(TRIM(p_params->>'categoria_id'), '')::uuid;
    ELSE
      v_categoria_id := NULL;
    END IF;
    IF v_categoria_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.catalogo_categorias WHERE id = v_categoria_id AND empresa_id = v_empresa_id
    ) THEN
      RAISE EXCEPTION 'La categoría no existe';
    END IF;

  ELSIF p_accion = 'cambiar_activo' THEN
    IF jsonb_typeof(p_params->'activo') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'cambiar_activo requiere params.activo booleano';
    END IF;
    v_activo := (p_params->>'activo')::boolean;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion;
  END IF;

  -- ===== Fase 1: validación de pertenencia =====
  SELECT array_agg(id) INTO v_validos
  FROM public.productos
  WHERE id = ANY(v_ids) AND empresa_id = v_empresa_id;

  v_validos := COALESCE(v_validos, ARRAY[]::uuid[]);

  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', x, 'motivo', 'No encontrado')),
           '[]'::jsonb
         )
  INTO v_omitidos
  FROM unnest(v_ids) AS x
  WHERE NOT (x = ANY(v_validos));

  -- ===== Fase 2: mutación atómica (set-based) =====
  IF array_length(v_validos, 1) IS NOT NULL THEN
    IF p_accion = 'precio_pct' THEN
      UPDATE public.productos
      SET precio_neto = GREATEST(round(precio_neto * (1 + v_pct / 100.0), 2), 0)
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'precio_fijo' THEN
      UPDATE public.productos
      SET precio_neto = round(v_precio, 2)
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'cambiar_marca' THEN
      UPDATE public.productos
      SET marca_id = v_marca_id
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'cambiar_categoria' THEN
      UPDATE public.productos
      SET categoria_id = v_categoria_id
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;

    ELSIF p_accion = 'cambiar_activo' THEN
      UPDATE public.productos
      SET activo = v_activo
      WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;
    END IF;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;
  END IF;

  v_ids_afectados := to_jsonb(v_validos);

  -- ===== Auditoría (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    p_accion, p_params,
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', p_accion,
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 14.J  productos_bulk_import — columnas 'marca' (resuelve/crea) + 'categoria'
--       (resuelve contra catalogo_categorias; si no existe, ignora + advierte)
--       (replica el cuerpo vigente de la migración 010 con la resolución nueva)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.productos_bulk_import(
  p_usuario_id uuid,
  p_cambios jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_total integer;
  v_omitidos jsonb := '[]'::jsonb;
  v_advertencias jsonb := '[]'::jsonb;
  v_afectados integer := 0;
  v_ids_afectados jsonb := '[]'::jsonb;
  v_ids_afectados_array uuid[] := '{}';
  v_operacion_id uuid;
  v_item jsonb;
  v_sku text;
  -- destino resuelto
  v_var_id uuid;
  v_prod_id uuid;
  v_prod_nombre text;
  v_var_sku text;
  v_stock_ant integer;
  -- flags de presencia
  v_has_precio boolean;
  v_has_marca boolean;
  v_has_categoria boolean;
  v_has_activo boolean;
  v_has_stock boolean;
  v_has_activa boolean;
  v_has_codbar boolean;
  -- resolución marca/categoria
  v_marca_nombre text;
  v_cat_nombre text;
  v_marca_id uuid;
  v_categoria_id uuid;
  v_set_marca boolean;
  v_set_categoria boolean;
  v_cambio boolean;
  v_stock_nuevo integer;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede importar productos';
  END IF;

  -- ===== Empresa (re-derivada) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación del payload =====
  IF jsonb_typeof(p_cambios) <> 'array' THEN
    RAISE EXCEPTION 'p_cambios debe ser un array JSON';
  END IF;

  v_total := jsonb_array_length(p_cambios);
  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay cambios para aplicar';
  END IF;
  IF v_total > 1000 THEN
    RAISE EXCEPTION 'Máximo 1000 filas por operación (recibidas: %)', v_total;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios)
      AS x(sku_variante text, precio_neto numeric, stock numeric)
    WHERE x.sku_variante IS NULL OR TRIM(x.sku_variante) = ''
       OR (x.precio_neto IS NOT NULL AND x.precio_neto <= 0)
       OR (x.stock IS NOT NULL AND (x.stock < 0 OR x.stock <> trunc(x.stock)))
  ) THEN
    RAISE EXCEPTION 'Hay filas con sku_variante vacío, precio <= 0 o stock inválido';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_cambios) AS x(sku_variante text)
    GROUP BY x.sku_variante
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay sku_variante duplicados en el archivo';
  END IF;

  -- ===== Loop por fila =====
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cambios)
  LOOP
    v_sku := TRIM(v_item->>'sku_variante');

    SELECT v.id, v.producto_id, v.stock, v.sku_variante, p.nombre
    INTO v_var_id, v_prod_id, v_stock_ant, v_var_sku, v_prod_nombre
    FROM public.variantes v
    JOIN public.productos p ON p.id = v.producto_id
    WHERE v.sku_variante = v_sku AND v.empresa_id = v_empresa_id
    LIMIT 1
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      v_omitidos := v_omitidos || jsonb_build_object('sku_variante', v_sku, 'motivo', 'SKU de variante no encontrado');
      CONTINUE;
    END IF;

    v_has_precio := (v_item ? 'precio_neto') AND jsonb_typeof(v_item->'precio_neto') = 'number';
    v_has_marca := (v_item ? 'marca');
    v_has_categoria := (v_item ? 'categoria');
    v_has_activo := (v_item ? 'activo') AND jsonb_typeof(v_item->'activo') = 'boolean';
    v_has_stock := (v_item ? 'stock') AND jsonb_typeof(v_item->'stock') = 'number';
    v_has_activa := (v_item ? 'activa') AND jsonb_typeof(v_item->'activa') = 'boolean';
    v_has_codbar := (v_item ? 'codigo_barras');

    -- ----- Resolver marca: crea la marca si no existe -----
    v_set_marca := false;
    IF v_has_marca THEN
      v_marca_nombre := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
      IF v_marca_nombre IS NULL THEN
        v_marca_id := NULL;          -- 'marca' presente y vacía => sin marca
        v_set_marca := true;
      ELSE
        INSERT INTO public.marcas (empresa_id, nombre, nombre_normalizado)
        VALUES (v_empresa_id, v_marca_nombre, public.normalizar_busqueda(v_marca_nombre))
        ON CONFLICT (empresa_id, nombre_normalizado)
          DO UPDATE SET nombre = marcas.nombre
        RETURNING id INTO v_marca_id;
        v_set_marca := true;
      END IF;
    END IF;

    -- ----- Resolver categoria: solo match, NO crea (curated) -----
    v_set_categoria := false;
    IF v_has_categoria THEN
      v_cat_nombre := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
      IF v_cat_nombre IS NULL THEN
        v_categoria_id := NULL;      -- 'categoria' presente y vacía => sin categoría
        v_set_categoria := true;
      ELSE
        SELECT id INTO v_categoria_id
        FROM public.catalogo_categorias
        WHERE empresa_id = v_empresa_id
          AND nombre_normalizado = public.normalizar_busqueda(v_cat_nombre);
        IF FOUND THEN
          v_set_categoria := true;
        ELSE
          v_advertencias := v_advertencias || jsonb_build_object(
            'sku_variante', v_sku,
            'motivo', 'Categoría "' || v_cat_nombre || '" no existe (se ignoró)'
          );
          v_set_categoria := false;
        END IF;
      END IF;
    END IF;

    v_cambio := false;

    -- ----- Product-level -----
    IF v_has_precio OR v_set_marca OR v_set_categoria OR v_has_activo THEN
      UPDATE public.productos p
      SET
        precio_neto = CASE WHEN v_has_precio
                           THEN round((v_item->>'precio_neto')::numeric, 2)
                           ELSE p.precio_neto END,
        marca_id    = CASE WHEN v_set_marca THEN v_marca_id ELSE p.marca_id END,
        categoria_id = CASE WHEN v_set_categoria THEN v_categoria_id ELSE p.categoria_id END,
        activo      = CASE WHEN v_has_activo
                           THEN (v_item->>'activo')::boolean
                           ELSE p.activo END
      WHERE p.id = v_prod_id AND p.empresa_id = v_empresa_id;
      v_cambio := true;
    END IF;

    -- ----- Variant-level -----
    IF v_has_stock OR v_has_activa OR v_has_codbar THEN
      v_stock_nuevo := CASE WHEN v_has_stock
                            THEN (v_item->>'stock')::int
                            ELSE v_stock_ant END;

      UPDATE public.variantes v
      SET
        stock = v_stock_nuevo,
        activa = CASE WHEN v_has_activa
                      THEN (v_item->>'activa')::boolean
                      ELSE v.activa END,
        codigo_barras = CASE WHEN v_has_codbar
                             THEN NULLIF(v_item->>'codigo_barras', '')
                             ELSE v.codigo_barras END
      WHERE v.id = v_var_id AND v.empresa_id = v_empresa_id;
      v_cambio := true;

      IF v_has_stock AND v_stock_nuevo <> v_stock_ant THEN
        BEGIN
          INSERT INTO public.audit_log (
            usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, detalle, empresa_id
          ) VALUES (
            p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
            'variantes', v_var_id::text, 'ajustar_stock',
            jsonb_build_object(
              'producto_nombre', v_prod_nombre,
              'variante_sku', v_var_sku,
              'stock_anterior', v_stock_ant,
              'delta', v_stock_nuevo - v_stock_ant,
              'stock_nuevo', v_stock_nuevo,
              'origen', 'import'
            ),
            v_empresa_id
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;

    IF v_cambio THEN
      v_afectados := v_afectados + 1;
      v_ids_afectados_array := array_append(v_ids_afectados_array, v_prod_id);
    END IF;
  END LOOP;

  v_ids_afectados := to_jsonb(v_ids_afectados_array);

  -- ===== Auditoría de la operación (atómica) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, cantidad_omitidos, omitidos, ids_afectados
  ) VALUES (
    v_empresa_id, p_usuario_id, COALESCE(v_usuario_email, 'desconocido'),
    'import', jsonb_build_object('tipo', 'import'),
    v_total, v_afectados, jsonb_array_length(v_omitidos), v_omitidos, v_ids_afectados
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'accion', 'bulk_import',
    'total_solicitados', v_total,
    'afectados', v_afectados,
    'cantidad_omitidos', jsonb_array_length(v_omitidos),
    'omitidos', v_omitidos,
    'advertencias', v_advertencias,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 14.K  importar_productos_bulk — alta/actualización masiva por plantilla
--       (migración 003). El Excel pasa a tener columnas 'marca' (se crea si no
--       existe) y 'categoria' (se matchea contra catalogo_categorias; si no
--       existe se ignora con advertencia, NO se crea — son curated).
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
  v_advertencias jsonb := '[]'::jsonb;
  v_skus_vistos text[] := ARRAY[]::text[];
  v_sku text;
  v_nombre text;
  v_marca text;
  v_cat_nombre text;
  v_marca_id uuid;
  v_categoria_id uuid;
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
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
    IF v_marca IS NOT NULL AND length(v_marca) > 100 THEN
      v_errores := v_errores || jsonb_build_object('fila', v_idx, 'sku', v_sku, 'motivo', 'Marca mayor a 100 caracteres');
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
    v_marca := NULLIF(TRIM(COALESCE(v_item->>'marca', '')), '');
    v_cat_nombre := NULLIF(TRIM(COALESCE(v_item->>'categoria', '')), '');
    v_precio := (v_item->>'precio_neto')::numeric;

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
          updated_at = NOW()
      WHERE id = v_producto_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      INSERT INTO public.productos (
        sku_base, nombre, marca_id, categoria_id, precio_neto,
        empresa_id, activo, track_stock
      ) VALUES (
        v_sku, v_nombre, v_marca_id, v_categoria_id, v_precio,
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

-- ----------------------------------------------------------------------------
-- Permisos (CREATE OR REPLACE preserva grants; se re-emiten por idempotencia)
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.productos_bulk_update(uuid, text, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.productos_bulk_import(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.importar_productos_bulk(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- Guard final
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_tabla integer;
  v_col_marca integer;
  v_col_cat integer;
  v_col_busq integer;
  v_col_busq_gen integer;
  v_col_vieja integer;
  v_trigger integer;
  v_idx integer;
  v_funcs integer;
BEGIN
  -- Tabla marcas
  SELECT count(*) INTO v_tabla
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'marcas';

  -- Columnas nuevas en productos
  SELECT count(*) INTO v_col_marca
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'marca_id';

  SELECT count(*) INTO v_col_cat
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'categoria_id';

  -- busqueda_normalizada existe y NO es generada
  SELECT count(*) INTO v_col_busq
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'busqueda_normalizada';

  SELECT count(*) INTO v_col_busq_gen
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos'
    AND column_name = 'busqueda_normalizada' AND is_generated = 'ALWAYS';

  -- vieja categoria text NO existe
  SELECT count(*) INTO v_col_vieja
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'categoria';

  -- trigger de búsqueda registrado
  SELECT count(*) INTO v_trigger
  FROM pg_trigger
  WHERE tgname = 'productos_busqueda_normalizada_trigger' AND NOT tgisinternal;

  -- índice GIN
  SELECT count(*) INTO v_idx
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'productos_busqueda_idx';

  -- las 5 RPCs de bulk siguen registradas
  SELECT count(*) INTO v_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'productos_bulk_update', 'productos_bulk_stock',
      'productos_bulk_precio_individual', 'productos_bulk_stock_individual',
      'productos_bulk_import'
    );

  IF v_tabla <> 1 THEN RAISE EXCEPTION 'No se creó la tabla marcas (%).', v_tabla; END IF;
  IF v_col_marca <> 1 THEN RAISE EXCEPTION 'Falta productos.marca_id (%).', v_col_marca; END IF;
  IF v_col_cat <> 1 THEN RAISE EXCEPTION 'Falta productos.categoria_id (%).', v_col_cat; END IF;
  IF v_col_busq <> 1 THEN RAISE EXCEPTION 'Falta productos.busqueda_normalizada (%).', v_col_busq; END IF;
  IF v_col_busq_gen <> 0 THEN RAISE EXCEPTION 'busqueda_normalizada NO debe ser GENERATED (%).', v_col_busq_gen; END IF;
  IF v_col_vieja <> 0 THEN RAISE EXCEPTION 'La vieja productos.categoria sigue existiendo (%).', v_col_vieja; END IF;
  IF v_trigger <> 1 THEN RAISE EXCEPTION 'No se registró el trigger de búsqueda (%).', v_trigger; END IF;
  IF v_idx <> 1 THEN RAISE EXCEPTION 'No se creó el índice productos_busqueda_idx (%).', v_idx; END IF;
  IF v_funcs <> 5 THEN RAISE EXCEPTION 'Se esperaban 5 RPCs de bulk, hay %.', v_funcs; END IF;

  RAISE NOTICE 'OK: marcas + productos.marca_id/categoria_id + busqueda_normalizada (columna+trigger) + vista + bulk_update/bulk_import.';
END;
$$;
