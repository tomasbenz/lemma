-- ============================================================
-- MIGRATION: afip_request_log — auditoría granular de llamadas a AFIP
-- Fecha: 2026-05-06 (UTC)
-- ============================================================
--
-- Tabla independiente de `facturas`: facturas guarda la factura final
-- emitida con CAE; afip_request_log guarda CADA call HTTP a AFIP
-- (LoginCms, FEDummy, FECompUltimoAutorizado, FECAESolicitar, retries
-- intermedios, etc.) para debugging y auditoría operacional.
--
-- Inmutable: solo INSERT desde service_role; UPDATE y DELETE bloqueados.
-- TTL 90 días, purga via cron nocturno (TODO al final, pg_cron OFF hoy).
--
-- SIN credenciales: el envelope WSAA va con CMS enmascarado, los
-- envelopes WSFE van con Token/Sign enmascarados. Ver
-- src/lib/afip/request-log.ts (maskearAuthEnEnvelope, maskearCmsEnEnvelope).
-- ============================================================

CREATE TYPE public.afip_resultado AS ENUM (
  'exito',
  'error_negocio',
  'error_red',
  'error_config'
);

CREATE TYPE public.afip_severidad AS ENUM (
  'reintentable',
  'permanente',
  'requiere_admin'
);

CREATE TABLE public.afip_request_log (
  id              bigserial PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modo            text NOT NULL CHECK (modo IN ('homologation', 'production')),
  servicio        text NOT NULL,                          -- 'wsaa' | 'wsfe'
  metodo          text NOT NULL,                          -- 'LoginCms' | 'FEDummy' | 'FECompUltimoAutorizado' | etc
  endpoint        text NOT NULL,                          -- URL completa
  intento         smallint NOT NULL DEFAULT 1 CHECK (intento >= 1),
  request_xml     text,                                   -- envelope masked, o '[CMS_BINARY len=N]' para LoginCms
  response_xml    text,                                   -- truncado a 16KB
  http_status     integer,                                -- null si error de red antes de respuesta
  duracion_ms     integer NOT NULL CHECK (duracion_ms >= 0),
  resultado       public.afip_resultado NOT NULL,
  codigos_error   integer[],                              -- de errors.ts
  severidad_max   public.afip_severidad,                  -- null si exito
  error_clase     text,                                   -- ej 'AfipWsfeError', 'TypeError'
  error_mensaje   text,                                   -- mensaje legible
  contexto        jsonb,                                  -- { puntoVenta, tipoComprobante, ... }
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices para queries comunes de auditoría:
-- 1. timeline de llamadas por empresa (ordenado desc para "últimas 100")
CREATE INDEX afip_request_log_empresa_created_idx
  ON public.afip_request_log(empresa_id, created_at DESC);

-- 2. partial index para "errores recientes" — la query más común del admin
CREATE INDEX afip_request_log_errores_idx
  ON public.afip_request_log(resultado, created_at DESC)
  WHERE resultado <> 'exito';

-- 3. para análisis por método (ej. cuántos FECAESolicitar en el día)
CREATE INDEX afip_request_log_metodo_idx
  ON public.afip_request_log(servicio, metodo, created_at DESC);

-- ============================================================
-- RLS: alineado al patrón del repo (mp_webhook_events, ventas, etc.)
-- - SELECT: superadmin global O admin de la empresa dueña del row
-- - INSERT/UPDATE/DELETE: bloqueado para clientes; el service_role
--   bypassea RLS y es quien escribe los logs desde el server.
-- ============================================================
ALTER TABLE public.afip_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afip_request_log FORCE ROW LEVEL SECURITY;

CREATE POLICY afip_request_log_select_admin
  ON public.afip_request_log
  FOR SELECT
  TO authenticated
  USING (
    public.es_superadmin()
    OR (
      public.es_admin_estricto()
      AND empresa_id = public.get_empresa_id()
    )
  );

-- INSERT bloqueado: solo service_role inserta (bypassea RLS)
CREATE POLICY afip_request_log_insert_blocked
  ON public.afip_request_log
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- UPDATE bloqueado: los logs son inmutables
CREATE POLICY afip_request_log_update_blocked
  ON public.afip_request_log
  FOR UPDATE
  TO authenticated
  USING (false);

-- DELETE bloqueado: la purga la hace el cron con service_role
CREATE POLICY afip_request_log_delete_blocked
  ON public.afip_request_log
  FOR DELETE
  TO authenticated
  USING (false);

COMMENT ON TABLE public.afip_request_log IS
  'Auditoría granular de cada llamada HTTP a AFIP (WSAA, WSFE). Inmutable. TTL 90 días via job nocturno (TODO: habilitar pg_cron). NO incluye CMS base64 ni tokens completos por seguridad — ver maskearAuthEnEnvelope/maskearCmsEnEnvelope en src/lib/afip/request-log.ts.';

-- ============================================================
-- TODO post-merge: habilitar purga automática de logs > 90 días
-- ============================================================
-- pg_cron está DESHABILITADO en este proyecto Supabase (mxkelleuppbdghmokcur).
-- Esta migration NO ejecuta cron.schedule() porque fallaría.
--
-- Cuando Tomás habilite pg_cron, correr lo siguiente DESDE Supabase
-- SQL Editor (NO en migration; el job va al schema cron, no public):
--
--   1. Habilitar la extensión:
--      Supabase Dashboard → Database → Extensions → pg_cron → Enable.
--
--   2. Programar el job (a las 03:00 AR cada noche):
--      SELECT cron.schedule(
--        'afip_request_log_purge',
--        '0 3 * * *',
--        $$DELETE FROM public.afip_request_log WHERE created_at < now() - interval '90 days'$$
--      );
--
--   3. Verificar que quedó programado:
--      SELECT jobname, schedule, active
--      FROM cron.job
--      WHERE jobname = 'afip_request_log_purge';
--
--   4. Para deshabilitar/borrar (si llega el caso):
--      SELECT cron.unschedule('afip_request_log_purge');
-- ============================================================
