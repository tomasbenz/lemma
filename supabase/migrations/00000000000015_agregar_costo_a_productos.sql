-- ============================================================================
-- 00000000000015_agregar_costo_a_productos.sql
-- ----------------------------------------------------------------------------
-- Agrega columna 'costo' a productos para calcular margen.
-- numeric(12,2) (mismo tipo que precio_neto). Nullable. Sin trigger.
--
-- NOTA: esta migracion YA está aplicada en producción (Supabase Samu).
-- Esto la versiona en el repo. Es idempotente (IF NOT EXISTS).
-- La carga inicial de costos se hizo desde 3 SQLs externos (3.881 productos).
-- ============================================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS costo numeric(12,2);

COMMENT ON COLUMN public.productos.costo IS
  'Costo unitario del producto (precio que paga la empresa al proveedor). Nullable. Cuando hay costo, el margen se calcula como (precio_neto - costo) / precio_neto.';

DO $$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'costo';
  IF v <> 1 THEN
    RAISE EXCEPTION 'No se creó productos.costo (%).', v;
  END IF;
  RAISE NOTICE 'OK: productos.costo verificada/creada.';
END;
$$;
