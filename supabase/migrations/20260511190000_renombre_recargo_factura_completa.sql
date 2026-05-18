-- Renombrar columna: recargo_iva_reducido → recargo_factura_completa
-- El nombre viejo era engañoso (sugiere alícuota IVA reducido).
-- El nuevo refleja la realidad: recargo del 10,5% cuando el cliente
-- pide factura completa. La factura va con IVA 21% normal.
--
-- Idempotente: solo renombrar si la columna vieja existe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ventas'
      AND column_name = 'recargo_iva_reducido'
  ) THEN
    ALTER TABLE ventas
      RENAME COLUMN recargo_iva_reducido TO recargo_factura_completa;
  END IF;
END $$;

-- El CHECK constraint ck_ventas_recargo_excluyente referencia la columna
-- vieja. PostgreSQL actualiza la referencia automáticamente al renombrar
-- la columna. Verificación post-aplicación:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'ck_ventas_recargo_excluyente';
-- Debería mostrar: CHECK ((NOT ((recargo_factura_completa = true) AND
--                       (recargo_porcentaje_manual IS NOT NULL))))
