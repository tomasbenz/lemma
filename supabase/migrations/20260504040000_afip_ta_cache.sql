-- ============================================================
-- MIGRATION: tabla afip_ta_cache para cachear Token de Acceso WSAA
-- Fecha: 2026-05-04
-- ============================================================
--
-- El TA (Token de Acceso) que devuelve WSAA dura 12 horas. AFIP rate-limitea
-- la generación de TAs nuevos, así que cachear es obligatorio.
--
-- En Vercel serverless el filesystem no persiste entre invocaciones, así que
-- el cache va en Supabase con multi-tenant (empresa_id).
--
-- Cada combinación (empresa_id, service, modo) tiene UN solo TA vigente.
-- Cuando se genera un nuevo TA se hace UPSERT sobre la PK.
-- ============================================================

CREATE TABLE public.afip_ta_cache (
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  service     text NOT NULL,                                      -- 'wsfe', futuro 'wsfex', etc.
  modo        text NOT NULL CHECK (modo IN ('homologation', 'production')),
  cuit        text NOT NULL,                                      -- audit/debug, no PK
  token       text NOT NULL,
  sign        text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, service, modo)
);

-- RLS: solo el service role accede. La tabla la lee el adaptador real
-- server-side, nunca clientes. Sin policies = nadie puede leer/escribir
-- desde el cliente. Con FORCE, ni siquiera el owner bypassea RLS.
ALTER TABLE public.afip_ta_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afip_ta_cache FORCE ROW LEVEL SECURITY;

-- Función trigger para updated_at automático
-- Se define con CREATE OR REPLACE para idempotencia: si ya existe en otra
-- migration o en Supabase Cloud, se reusa. Si no existe, se crea acá.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER afip_ta_cache_set_updated_at
BEFORE UPDATE ON public.afip_ta_cache
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index para queries de cleanup de TAs expirados (futuro maintenance)
CREATE INDEX afip_ta_cache_expires_at_idx ON public.afip_ta_cache(expires_at);
