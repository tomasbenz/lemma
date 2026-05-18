-- ============================================================
-- Sprint 3 / Tarea 1 (parte 2/2): Schema completo para NC/ND AFIP
--
-- Esta migration corre DESPUÉS de la parte 1/2 que agregó los values
-- nota_credito_a, nota_credito_b, nota_debito_a, nota_debito_b al enum.
--
-- Cambios:
-- 1. Columna factura_asociada_id (self-reference FK).
-- 2. Index parcial para búsquedas eficientes de NC/ND por factura.
-- 3. Constraint coherencia tipo ↔ factura_asociada_id.
-- 4. Estado 'anulada_por_nc' agregado al CHECK de estado.
-- 5. Comments documentando los campos.
--
-- IF EXISTS / IF NOT EXISTS defensivo: el schema baseline no está
-- versionado todavía (memoria #17 del proyecto). Si alguien aplicó
-- algo manualmente desde Supabase dashboard, queremos fallar limpio.
-- ============================================================

-- ============================================================
-- 1. Agregar columna factura_asociada_id
-- ============================================================
-- Nullable. Las facturas comunes no tienen factura asociada.
-- Las NC/ND apuntan a la factura original que están corrigiendo.
-- ON DELETE RESTRICT: no se puede borrar una factura si tiene NC/ND
-- apuntándola (protege la trazabilidad fiscal).

ALTER TABLE facturas_afip
  ADD COLUMN IF NOT EXISTS factura_asociada_id uuid
    REFERENCES facturas_afip(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_facturas_afip_factura_asociada
  ON facturas_afip(factura_asociada_id)
  WHERE factura_asociada_id IS NOT NULL;

-- ============================================================
-- 2. Constraint coherencia tipo ↔ factura_asociada_id
-- ============================================================
-- NC/ND DEBEN tener factura_asociada_id. Facturas y sin_factura NO
-- deben tenerlo. Esto atrapa bugs antes de llegar a producción.

ALTER TABLE facturas_afip
  DROP CONSTRAINT IF EXISTS facturas_afip_factura_asociada_check;

ALTER TABLE facturas_afip
  ADD CONSTRAINT facturas_afip_factura_asociada_check CHECK (
    (
      tipo_factura IN ('nota_credito_a', 'nota_credito_b',
                       'nota_debito_a', 'nota_debito_b')
      AND factura_asociada_id IS NOT NULL
    )
    OR
    (
      tipo_factura NOT IN ('nota_credito_a', 'nota_credito_b',
                           'nota_debito_a', 'nota_debito_b')
      AND factura_asociada_id IS NULL
    )
  );

-- ============================================================
-- 3. Extender CHECK de estado con 'anulada_por_nc'
-- ============================================================
-- Cuando se emite una NC asociada, la factura original pasa a este
-- estado para que filtros rápidos sepan que ya no está fiscalmente
-- activa, sin perder el registro original (CAE, número, etc).
--
-- Estados resultantes:
--   pendiente       → emisión en proceso
--   aprobada        → emitida con CAE válido, fiscalmente activa
--   rechazada       → AFIP rechazó la emisión
--   error           → error técnico durante emisión
--   anulada_por_nc  → emitida pero anulada por NC posterior

ALTER TABLE facturas_afip
  DROP CONSTRAINT IF EXISTS facturas_afip_estado_check;

ALTER TABLE facturas_afip
  ADD CONSTRAINT facturas_afip_estado_check CHECK (
    estado = ANY (ARRAY[
      'pendiente'::text,
      'aprobada'::text,
      'rechazada'::text,
      'error'::text,
      'anulada_por_nc'::text
    ])
  );

-- ============================================================
-- 4. Comments para documentación inline
-- ============================================================

COMMENT ON COLUMN facturas_afip.factura_asociada_id IS
  'Para NC/ND: id de la factura original que esta nota corrige. Para facturas comunes: NULL. Constraint facturas_afip_factura_asociada_check garantiza coherencia.';

COMMENT ON COLUMN facturas_afip.estado IS
  'pendiente=en proceso | aprobada=CAE válido | rechazada=AFIP rechazó | error=falla técnica | anulada_por_nc=anulada por NC posterior';
