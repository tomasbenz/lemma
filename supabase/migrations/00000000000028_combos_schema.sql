-- ============================================================================
-- 00000000000028_combos_schema.sql
-- ----------------------------------------------------------------------------
-- FEATURE COMBOS — Migración A de 3 (solo schema base + integridad estructural).
--
-- Un combo es un producto (es_combo=true) que agrupa varias variantes de OTROS
-- productos con un % de descuento sobre la suma de sus precios.
--
-- Decisiones confirmadas (D1-D5):
--   D1  combo_componentes apunta a una VARIANTE (componente_variante_id), no a
--       un producto. El componente debe tener 1 sola variante activa (sin
--       ambigüedad de qué stock descontar en la venta).
--   D2  precio_neto y costo del combo serán columnas DENORMALIZADAS mantenidas
--       por triggers (Migración B). Acá NO se agregan esos triggers.
--   D3  Bloquear desactivar/eliminar un componente requiere TRIGGER (Migración B),
--       además del FK RESTRICT que ya queda acá sobre componente_variante_id /
--       componente_producto_id.
--   D4  cerrar_venta sigue confiando en el precio del cliente. Cambios aditivos
--       de cascada de stock en Migración C.
--   D5  stock derivado del combo = floor(min(stock_componente_i / cantidad_i)),
--       vía función stock_combo() + vista (Migración B).
--
-- SCOPE DE ESTA MIGRACIÓN (A): columnas es_combo/descuento_combo_pct, tabla
-- combo_componentes, RLS, índices y triggers de INTEGRIDAD ESTRUCTURAL
-- (anti-anidación, combo↔producto coherente, componente de 1 variante, combo
-- con exactamente 1 variante). NADA de precio/stock/RPC/UI.
--
-- IMPORTANTE: NO se aplica automáticamente. Tomás la aplica a mano en prod.
-- Después correr `npm run db:types` antes del commit que la consuma.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Columnas nuevas en productos
-- ----------------------------------------------------------------------------
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS es_combo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS descuento_combo_pct numeric(5,2) NULL
    CHECK (descuento_combo_pct IS NULL OR (descuento_combo_pct >= 0 AND descuento_combo_pct <= 99));

-- Coherencia es_combo ↔ descuento: si es combo, el descuento es obligatorio;
-- si no es combo, debe ser NULL. Las filas existentes (es_combo=false,
-- descuento NULL por default) satisfacen el constraint, así que no falla el ALTER.
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS chk_combo_descuento;
ALTER TABLE public.productos
  ADD CONSTRAINT chk_combo_descuento CHECK (
    (es_combo = false AND descuento_combo_pct IS NULL) OR
    (es_combo = true  AND descuento_combo_pct IS NOT NULL)
  );

-- ----------------------------------------------------------------------------
-- 2) Tabla combo_componentes
-- ----------------------------------------------------------------------------
-- componente_producto_id es redundante con variantes.producto_id, pero se guarda
-- para evitar joins en queries calientes (cerrar_venta, triggers de Migración B).
-- El trigger de integridad mantiene ambos coherentes.
CREATE TABLE IF NOT EXISTS public.combo_componentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  combo_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  componente_variante_id uuid NOT NULL REFERENCES public.variantes(id) ON DELETE RESTRICT,
  componente_producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad integer NOT NULL CHECK (cantidad >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (combo_id, componente_variante_id)
);

-- ----------------------------------------------------------------------------
-- 3) Índices
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS combo_componentes_combo_idx
  ON public.combo_componentes(combo_id);
CREATE INDEX IF NOT EXISTS combo_componentes_variante_idx
  ON public.combo_componentes(componente_variante_id);
CREATE INDEX IF NOT EXISTS combo_componentes_producto_idx
  ON public.combo_componentes(componente_producto_id);
CREATE INDEX IF NOT EXISTS combo_componentes_empresa_idx
  ON public.combo_componentes(empresa_id);

CREATE TRIGGER combo_componentes_set_updated_at
  BEFORE UPDATE ON public.combo_componentes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) RLS (mismo patrón que productos/variantes: select con superadmin + write
--    por empresa). Las RPCs de Migración C serán SECURITY DEFINER, pero las
--    policies permiten CRUD scopeado por empresa igual que el resto del catálogo.
-- ----------------------------------------------------------------------------
ALTER TABLE public.combo_componentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS combo_componentes_select ON public.combo_componentes;
CREATE POLICY combo_componentes_select ON public.combo_componentes FOR SELECT
  USING (es_superadmin() OR empresa_id = get_empresa_id());

DROP POLICY IF EXISTS combo_componentes_write ON public.combo_componentes;
CREATE POLICY combo_componentes_write ON public.combo_componentes FOR ALL
  USING (empresa_id = get_empresa_id())
  WITH CHECK (empresa_id = get_empresa_id());

-- ----------------------------------------------------------------------------
-- 5) Triggers de INTEGRIDAD ESTRUCTURAL
-- ----------------------------------------------------------------------------

-- 5.1 Validación de cada fila de combo_componentes (anti-anidación + coherencia
--     combo↔producto + componente de 1 variante). Una sola función para no
--     re-leer las mismas filas en triggers separados.
CREATE OR REPLACE FUNCTION public.combo_componentes_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_combo_es_combo boolean;
  v_combo_empresa uuid;
  v_comp_es_combo boolean;
  v_comp_empresa uuid;
  v_var_producto_id uuid;
  v_var_empresa uuid;
  v_var_activa boolean;
  v_count_variantes integer;
BEGIN
  -- El combo destino debe existir, ser de la misma empresa y tener es_combo=true.
  SELECT es_combo, empresa_id INTO v_combo_es_combo, v_combo_empresa
  FROM public.productos WHERE id = NEW.combo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El combo no existe';
  END IF;
  IF v_combo_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'El combo pertenece a otra empresa';
  END IF;
  IF NOT v_combo_es_combo THEN
    RAISE EXCEPTION 'El producto destino no es un combo';
  END IF;

  -- Un combo no puede contenerse a sí mismo.
  IF NEW.combo_id = NEW.componente_producto_id THEN
    RAISE EXCEPTION 'Un combo no puede contenerse a sí mismo';
  END IF;

  -- La variante componente debe existir, misma empresa, y su producto_id matchear
  -- componente_producto_id (coherencia del campo denormalizado).
  SELECT producto_id, empresa_id, activa
    INTO v_var_producto_id, v_var_empresa, v_var_activa
  FROM public.variantes WHERE id = NEW.componente_variante_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante componente no existe';
  END IF;
  IF v_var_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'La variante componente pertenece a otra empresa';
  END IF;
  IF v_var_producto_id <> NEW.componente_producto_id THEN
    RAISE EXCEPTION 'componente_producto_id no coincide con el producto de la variante';
  END IF;
  IF NOT v_var_activa THEN
    RAISE EXCEPTION 'La variante componente está inactiva';
  END IF;

  -- El producto componente: misma empresa, NO combo (anti-anidación, D/decisión 3),
  -- y con EXACTAMENTE 1 variante activa (D1: target de stock no ambiguo).
  SELECT es_combo, empresa_id INTO v_comp_es_combo, v_comp_empresa
  FROM public.productos WHERE id = NEW.componente_producto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto componente no existe';
  END IF;
  IF v_comp_empresa <> NEW.empresa_id THEN
    RAISE EXCEPTION 'El producto componente pertenece a otra empresa';
  END IF;
  IF v_comp_es_combo THEN
    RAISE EXCEPTION 'No se puede anidar combos: un componente no puede ser a su vez un combo';
  END IF;

  SELECT count(*) INTO v_count_variantes
  FROM public.variantes
  WHERE producto_id = NEW.componente_producto_id AND activa;
  IF v_count_variantes <> 1 THEN
    RAISE EXCEPTION 'Solo se pueden usar productos con una sola variante como componentes de combo';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS combo_componentes_validar_trg ON public.combo_componentes;
CREATE TRIGGER combo_componentes_validar_trg
  BEFORE INSERT OR UPDATE ON public.combo_componentes
  FOR EACH ROW EXECUTE FUNCTION public.combo_componentes_validar();

-- 5.2 Un producto que pasa a es_combo=true debe tener exactamente 1 variante.
--     (Decisión 2: 1 variante default por combo.) Fire sólo en la transición
--     false→true. El flujo de creación (RPC, Migración C) crea el producto +
--     su variante default y recién después marca es_combo=true.
CREATE OR REPLACE FUNCTION public.productos_validar_es_combo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NEW.es_combo AND NOT OLD.es_combo THEN
    SELECT count(*) INTO v_count
    FROM public.variantes WHERE producto_id = NEW.id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Un combo debe tener exactamente 1 variante (encontradas: %)', v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS productos_validar_es_combo_trg ON public.productos;
CREATE TRIGGER productos_validar_es_combo_trg
  BEFORE UPDATE OF es_combo ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.productos_validar_es_combo();

-- ----------------------------------------------------------------------------
-- 6) Smoke test de la migración (falla ruidosamente si algo no quedó creado)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_cols integer;
  v_tabla integer;
  v_triggers integer;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos'
    AND column_name IN ('es_combo', 'descuento_combo_pct');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'Faltan columnas es_combo/descuento_combo_pct (encontradas: %)', v_cols;
  END IF;

  SELECT count(*) INTO v_tabla
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'combo_componentes';
  IF v_tabla <> 1 THEN
    RAISE EXCEPTION 'No se creó la tabla combo_componentes';
  END IF;

  SELECT count(*) INTO v_triggers
  FROM information_schema.triggers
  WHERE event_object_table IN ('productos', 'combo_componentes')
    AND trigger_name IN ('combo_componentes_validar_trg', 'productos_validar_es_combo_trg');
  -- combo_componentes_validar_trg cuenta 2 veces (INSERT + UPDATE) en
  -- information_schema.triggers; productos_validar_es_combo_trg cuenta 1.
  IF v_triggers < 2 THEN
    RAISE EXCEPTION 'Faltan triggers de integridad de combos (encontrados: %)', v_triggers;
  END IF;

  RAISE NOTICE 'OK: combos schema (mig 028) aplicado — columnas, tabla y triggers de integridad creados.';
END;
$$;
