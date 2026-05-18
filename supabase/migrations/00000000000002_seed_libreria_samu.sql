-- ============================================================================
-- Lemma — Seed inicial: Librería Samu
-- ============================================================================
--
-- Crea la primera empresa (Librería Samu) con su sucursal default, caja default
-- y un usuario admin placeholder.
--
-- NOTA — auth.users:
--   El usuario admin se crea en `usuarios` pero NO en `auth.users`. El registro
--   en Auth debe hacerlo Tomás manualmente desde el dashboard de Supabase la
--   primera vez (Authentication → Users → Add user) usando el mismo email que
--   aparece acá. Una vez que el usuario exista en auth.users con el mismo UUID,
--   ya puede loguearse y operar como admin de Lemma.
--
-- IDs UUIDs hardcoded para que el seed sea idempotente y para que Tomás pueda
-- referenciarlos al crear el usuario en auth.users.
-- ============================================================================

-- Empresa: Librería Samu
INSERT INTO empresas (
  id,
  nombre,
  slug,
  activo,
  rubro,
  multi_sucursal,
  multi_caja,
  features
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Librería Samu',
  'libreria-samu',
  true,
  'libreria',
  false,
  false,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Sucursal default
INSERT INTO sucursales (
  id,
  empresa_id,
  nombre,
  activa
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Local único',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Caja default
INSERT INTO cajas (
  id,
  sucursal_id,
  nombre,
  activa
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Caja única',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Configuración fiscal (placeholder, completar con datos reales de Samu)
INSERT INTO configuracion (
  empresa_id,
  razon_social,
  cuit,
  condicion_iva,
  punto_venta_default,
  puntos_venta
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Librería Samu',
  '',
  'IVA Responsable Inscripto',
  1,
  '{1}'
)
ON CONFLICT (empresa_id) DO NOTHING;

-- ============================================================================
-- Usuario admin placeholder
-- ============================================================================
-- Este INSERT crea la fila en `usuarios` pero NO en `auth.users`. Para que el
-- admin pueda loguearse, Tomás tiene que:
--   1. Crear el usuario en Supabase Auth (Authentication → Users → Add user)
--      con email 'admin@libreriasamu.com.ar' y una contraseña inicial.
--   2. Anotar el UUID que Supabase Auth genera.
--   3. Actualizar este INSERT con el UUID real o UPDATE la fila usuarios.id
--      al UUID que matcheen auth.users.id.
--
-- Si el UUID acá (44444444-4444-...) no matchea con auth.users.id, el login
-- va a funcionar pero la sesión no va a tener empresa_id (porque la query a
-- usuarios va a fallar el JOIN por id). El sistema redirige a /login con error.
-- ============================================================================

INSERT INTO usuarios (
  id,
  empresa_id,
  email,
  nombre_completo,
  rol,
  activo
) VALUES (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  'admin@libreriasamu.com.ar',
  'Admin Samu',
  'admin',
  true
)
ON CONFLICT (id) DO NOTHING;
