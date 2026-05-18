-- ============================================================
-- Sprint 3 / Tarea 1 (parte 1/2): Agregar values NC/ND al enum tipo_factura
--
-- IMPORTANTE: esta migration agrega SOLO los values del enum.
-- La columna factura_asociada_id, los constraints y el estado nuevo
-- van en la migration siguiente (parte 2/2).
--
-- Razón del split: Postgres no permite usar un value recién agregado
-- a un enum dentro de la misma transacción. Como supabase db push
-- corre cada archivo en su propia transacción, separar las 2 partes
-- garantiza que los values estén "visibles" cuando la parte 2/2
-- referencie nota_credito_a, etc. en el CHECK constraint.
--
-- Mapeo cbteTipo AFIP:
--   nota_credito_a  → 3
--   nota_credito_b  → 8
--   nota_debito_a   → 2
--   nota_debito_b   → 7
--
-- NO se incluye tipo C porque Iconic Fashion (RI) no emite Factura C
-- ni sus NC/ND asociadas.
-- ============================================================

ALTER TYPE tipo_factura ADD VALUE IF NOT EXISTS 'nota_credito_a';
ALTER TYPE tipo_factura ADD VALUE IF NOT EXISTS 'nota_credito_b';
ALTER TYPE tipo_factura ADD VALUE IF NOT EXISTS 'nota_debito_a';
ALTER TYPE tipo_factura ADD VALUE IF NOT EXISTS 'nota_debito_b';
