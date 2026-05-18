-- ============================================================================
-- Lemma — Sucursales y Cajas
-- ============================================================================
--
-- Modelo multi-sucursal y multi-caja. Para empresas con `multi_sucursal=false`
-- (default), se crea una sucursal y una caja default por empresa y todas las
-- ventas se asocian automáticamente vía helpers get_default_*().
--
-- Para Librería Samu (caso single-local) el seed crea una sucursal "Local único"
-- y una caja "Caja única" automáticamente.
--
-- ============================================================================

CREATE TABLE sucursales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  direccion text,
  localidad text,
  provincia text,
  telefono text,
  activa boolean NOT NULL DEFAULT true,
  eliminada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sucursales_empresa_idx ON sucursales(empresa_id);
CREATE UNIQUE INDEX sucursales_empresa_nombre_activa_unq
  ON sucursales(empresa_id, nombre)
  WHERE activa;
CREATE TRIGGER sucursales_set_updated_at BEFORE UPDATE ON sucursales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cajas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  eliminada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cajas_sucursal_idx ON cajas(sucursal_id);
CREATE UNIQUE INDEX cajas_sucursal_nombre_activa_unq
  ON cajas(sucursal_id, nombre)
  WHERE activa;
CREATE TRIGGER cajas_set_updated_at BEFORE UPDATE ON cajas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FKs en ventas (las columnas se crearon en la migración inicial)
-- ============================================================================

ALTER TABLE ventas
  ADD CONSTRAINT ventas_caja_id_fk
  FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL;

ALTER TABLE ventas
  ADD CONSTRAINT ventas_sucursal_id_fk
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE SET NULL;

CREATE INDEX ventas_caja_idx ON ventas(caja_id);
CREATE INDEX ventas_sucursal_idx ON ventas(sucursal_id);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;

CREATE POLICY sucursales_select ON sucursales FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY sucursales_write ON sucursales FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

-- Cajas heredan empresa via sucursal. RLS las restringe vía join.
CREATE POLICY cajas_select ON cajas FOR SELECT
  USING (
    es_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = current_empresa_id()
    )
  );

CREATE POLICY cajas_write ON cajas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = current_empresa_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sucursales s
      WHERE s.id = cajas.sucursal_id
        AND s.empresa_id = current_empresa_id()
    )
  );

-- ============================================================================
-- HELPERS: default sucursal/caja por empresa
-- ============================================================================
-- Útiles para el flow cuando empresas.multi_sucursal=false: el server action
-- de cerrar_venta puede llamar a get_default_caja_id() y persistir el id en
-- ventas.caja_id sin pedirle a la usuaria que lo elija.

CREATE OR REPLACE FUNCTION get_default_sucursal_id(p_empresa_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM sucursales
  WHERE empresa_id = p_empresa_id AND activa
  ORDER BY created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_default_caja_id(p_empresa_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT c.id
  FROM cajas c
  JOIN sucursales s ON s.id = c.sucursal_id
  WHERE s.empresa_id = p_empresa_id AND c.activa AND s.activa
  ORDER BY c.created_at ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION get_default_sucursal_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_default_caja_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_default_sucursal_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_default_caja_id(uuid) TO authenticated, service_role;
