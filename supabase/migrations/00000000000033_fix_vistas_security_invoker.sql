-- Migración 033: cerrar fugas multi-tenant en vistas sin security_invoker
--
-- Findings F-01 y F-02 del relevamiento de seguridad
-- (docs/security/seguridad-multitenant-relevamiento.md).
--
-- F-01 confirmada en vivo el 2026-06-15: con auth.uid() de un admin de
-- Samu, ventas_con_resumen devolvía 1935 filas pertenecientes a 2 tenants.
--
-- IMPORTANTE: usar `true` literal, NO `on`. Supabase ignora silenciosamente
-- `security_invoker = on` en este contexto (aprendizaje de mig018).

ALTER VIEW public.ventas_con_resumen   SET (security_invoker = true);
ALTER VIEW public.v_acciones_superadmin SET (security_invoker = true);
