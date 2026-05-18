-- ============================================================================
-- Lemma — Split de feature flag recargo_manual_habilitado
-- ============================================================================
--
-- Hasta ahora `empresas.features.recargo_manual_habilitado` controlaba 4
-- elementos UI distintos a la vez:
--   (a) Checkbox "Cobrar 10,5% extra al cliente".
--   (b) Sección "Recargo manual (opcional)" + "+ Aplicar recargo manual".
--   (c) Presets 30/50/100 de "Monto a facturar".
--   (d) Input numérico libre de "Monto a facturar".
--
-- Para Lemma + Samu queremos (b), (c) y (d) pero NO (a). Por eso splitea-
-- mos en dos flags:
--
--   recargo_manual_habilitado  → controla (b), (c), (d). Default true para
--                                las empresas existentes (preservar comportamiento).
--   recargo_105_habilitado     → controla SOLO (a). Default false para Samu;
--                                para empresas que ya tenían recargo_manual=true
--                                (case Iconic Fashion), se preserva en true para
--                                no romper su flow histórico.
--
-- Idempotencia: la migration se puede re-ejecutar N veces sin alterar el
-- resultado. Cada UPDATE tiene un guard `WHERE NOT (features ? 'flag')` o
-- valores constantes en el override de Samu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Agregar recargo_105_habilitado donde no exista.
--    Copia el valor previo de recargo_manual_habilitado (default false si
--    nunca fue seteado) — preserva el comportamiento original donde un solo
--    flag prendía ambos.
-- ----------------------------------------------------------------------------

UPDATE public.empresas
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'recargo_105_habilitado',
  COALESCE(features->'recargo_manual_habilitado', 'false'::jsonb)::boolean
)
WHERE NOT (COALESCE(features, '{}'::jsonb) ? 'recargo_105_habilitado');

-- ----------------------------------------------------------------------------
-- 2. Asegurar recargo_manual_habilitado=true donde no esté seteado.
--    Necesario porque ahora el default operativo de Lemma es "Samu necesita
--    el manual" (Bloque 3 del prompt). Si una empresa ya lo tiene seteado
--    en false explícito, este UPDATE no la toca.
-- ----------------------------------------------------------------------------

UPDATE public.empresas
SET features = COALESCE(features, '{}'::jsonb)
  || jsonb_build_object('recargo_manual_habilitado', true)
WHERE NOT (COALESCE(features, '{}'::jsonb) ? 'recargo_manual_habilitado');

-- ----------------------------------------------------------------------------
-- 3. Override puntual para Librería Samu: manual=true, 10,5%=false.
--    Valores constantes → idempotente.
-- ----------------------------------------------------------------------------

UPDATE public.empresas
SET features = COALESCE(features, '{}'::jsonb)
  || jsonb_build_object('recargo_manual_habilitado', true)
  || jsonb_build_object('recargo_105_habilitado', false)
WHERE slug = 'libreria-samu';

-- ----------------------------------------------------------------------------
-- Reload del schema cache de PostgREST (en este caso no agregamos cols, pero
-- los consumidores client-side que cachean `features` pueden beneficiarse).
-- ----------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
