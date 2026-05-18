-- Defense in depth: validar pre-condición antes del ALTER
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ventas
    WHERE recargo_iva_reducido = true
  ) THEN
    -- OK: hay ventas con recargo 10,5%, pero ninguna debería tener
    -- recargo_porcentaje_manual porque la columna no existe todavía.
    NULL;
  END IF;
END $$;

-- Columnas nuevas
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS recargo_porcentaje_manual NUMERIC(5,2) NULL
    CHECK (recargo_porcentaje_manual IS NULL OR (recargo_porcentaje_manual >= 0 AND recargo_porcentaje_manual <= 100)),
  ADD COLUMN IF NOT EXISTS recargo_motivo TEXT NULL;

COMMENT ON COLUMN ventas.recargo_porcentaje_manual IS
  'Porcentaje de recargo manual aplicado por la cajera (ej: 30 para 30%). Mutuamente excluyente con recargo_iva_reducido.';
COMMENT ON COLUMN ventas.recargo_motivo IS
  'Motivo opcional del recargo manual (ej: "tarjeta de crédito"). Solo informativo.';

-- Mutex defense in depth: no se pueden activar los 2 recargos a la vez.
-- Idempotente: solo agregar si no existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ventas'::regclass
      AND conname = 'ck_ventas_recargo_excluyente'
  ) THEN
    ALTER TABLE ventas
      ADD CONSTRAINT ck_ventas_recargo_excluyente
      CHECK (NOT (recargo_iva_reducido = true AND recargo_porcentaje_manual IS NOT NULL));
  END IF;
END $$;
