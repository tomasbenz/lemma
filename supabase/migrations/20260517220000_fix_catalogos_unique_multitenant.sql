-- Fix bug arquitectonico multitenant: catalogo_colores y catalogo_talles
-- tenian UNIQUE globales sobre nombre/nombre_normalizado, lo que impedia
-- que distintas empresas tuvieran items con mismo nombre.
--
-- catalogo_categorias ya estaba bien (compuesto empresa_id + nombre_normalizado).
-- Esta migration alinea las otras dos al mismo patron.
--
-- Aplicado en prod el 17-may-2026 via SQL Editor de Supabase.

-- colores
ALTER TABLE public.catalogo_colores DROP CONSTRAINT IF EXISTS catalogo_colores_nombre_key;
ALTER TABLE public.catalogo_colores DROP CONSTRAINT IF EXISTS catalogo_colores_nombre_normalizado_key;
ALTER TABLE public.catalogo_colores
  ADD CONSTRAINT catalogo_colores_empresa_id_nombre_normalizado_key
  UNIQUE (empresa_id, nombre_normalizado);

-- talles
ALTER TABLE public.catalogo_talles DROP CONSTRAINT IF EXISTS catalogo_talles_nombre_key;
ALTER TABLE public.catalogo_talles DROP CONSTRAINT IF EXISTS catalogo_talles_nombre_normalizado_key;
ALTER TABLE public.catalogo_talles
  ADD CONSTRAINT catalogo_talles_empresa_id_nombre_normalizado_key
  UNIQUE (empresa_id, nombre_normalizado);
