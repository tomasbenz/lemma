-- ============================================================
-- 20260503120000_mp_webhook_security.sql
--
-- Hardening de seguridad para `mp_webhook_events`:
--   1. UNIQUE en `event_id` para idempotencia atómica vía
--      INSERT ... ON CONFLICT.
--   2. RLS policies explícitas: insert/update/delete denegados
--      desde anon/authenticated; select solo superadmin o admin
--      del tenant que matchea `empresa_id`.
--      service_role bypasea RLS por default — el handler corre
--      con admin client.
--   3. Índice en `pagos.mp_payment_id` para que el lookup de
--      tenant en el handler sea O(log n).
--
-- Aplicar a mano en SQL editor de Supabase. Idempotente.
--
-- Estrena `supabase/migrations/`. A partir de acá, los cambios
-- de schema deberían vivir versionados en este directorio.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. UNIQUE en event_id
-- Idempotente vía CREATE UNIQUE INDEX IF NOT EXISTS:
-- si ya existe (con este nombre) no falla.
-- Si la tabla tuviera datos duplicados el índice fallaría —
-- hoy la tabla está vacía (no hay handler que escriba).
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS mp_webhook_events_event_id_key
  ON public.mp_webhook_events (event_id);

-- ------------------------------------------------------------
-- 2. RLS policies
-- Asegurar que RLS esté ON (idempotente).
-- ------------------------------------------------------------
ALTER TABLE public.mp_webhook_events ENABLE ROW LEVEL SECURITY;

-- Drop SOLO las policies con los nombres que vamos a crear,
-- para no pisar otras que pudieran existir con nombres distintos.
DROP POLICY IF EXISTS mp_webhook_events_insert_deny_clients
  ON public.mp_webhook_events;
DROP POLICY IF EXISTS mp_webhook_events_select_admin
  ON public.mp_webhook_events;
DROP POLICY IF EXISTS mp_webhook_events_update_deny_clients
  ON public.mp_webhook_events;
DROP POLICY IF EXISTS mp_webhook_events_delete_deny
  ON public.mp_webhook_events;

-- INSERT: rechazar desde cualquier rol cliente.
-- service_role bypasea RLS, así que el handler sigue pudiendo insertar.
CREATE POLICY mp_webhook_events_insert_deny_clients
  ON public.mp_webhook_events
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

-- SELECT: superadmin ve todo; admin estricto ve solo su empresa.
-- vendedor no ve nada.
CREATE POLICY mp_webhook_events_select_admin
  ON public.mp_webhook_events
  FOR SELECT
  TO authenticated
  USING (
    public.es_superadmin()
    OR (
      public.es_admin_estricto()
      AND empresa_id = public.get_empresa_id()
    )
  );

-- UPDATE: rechazar desde cliente; solo el handler (service_role) actualiza
-- procesado/procesado_at/error/empresa_id.
CREATE POLICY mp_webhook_events_update_deny_clients
  ON public.mp_webhook_events
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- DELETE: prohibido para clientes. Los eventos son históricos.
-- Si alguna vez hace falta purgar, se hace con service_role explícito.
CREATE POLICY mp_webhook_events_delete_deny
  ON public.mp_webhook_events
  FOR DELETE
  TO authenticated, anon
  USING (false);

-- ------------------------------------------------------------
-- 3. Índice en pagos.mp_payment_id
-- Partial index (solo filas con valor) para que ocupe menos.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS pagos_mp_payment_id_idx
  ON public.pagos (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

COMMIT;
