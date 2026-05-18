-- ============================================================================
-- Lemma — Schema inicial consolidado
-- ============================================================================
--
-- Esta migración consolida el schema completo de Lemma a partir del clon de
-- Loom Point. Cambios principales respecto al schema original:
--
--   * Generalización de variantes:
--       variantes ya NO tiene columnas `color` y `talle` (textil). En su
--       lugar tiene `atributos jsonb` que guarda pares clave/valor arbitrarios
--       (color, formato, gramaje, tamaño, presentación, sabor, edición, etc.).
--       Mismo cambio en items_venta (variante_atributos jsonb).
--
--   * Tabla nueva `categoria_atributos`:
--       Cada categoría define qué atributos espera y de qué tipo. El form
--       de creación de productos puede renderizar fields dinámicamente
--       leyendo esta tabla.
--
--   * Tablas catalogo_colores y catalogo_talles ELIMINADAS (eran específicas
--     del rubro textil del cliente original).
--
--   * empresas extendida con:
--       - features  jsonb default '{}'  → feature flags por empresa
--         (recargo_manual_habilitado, etc.)
--       - rubro     text default 'libreria'  → categoría comercial
--       - multi_sucursal / multi_caja booleans → activa flow multi-local
--
--   * ventas extendida con columnas opcionales caja_id y sucursal_id (FK).
--
-- Migraciones siguientes:
--   00000000000001_sucursales_cajas.sql  → CREATE TABLE sucursales/cajas + helpers
--   00000000000002_seed_libreria_samu.sql → Seed inicial para Librería Samu
--
-- IMPORTANTE — RPCs y triggers heavy:
-- Esta migración crea el ESQUELETO de tablas, enums, índices, RLS y triggers
-- de updated_at. Las RPCs operativas pesadas (cerrar_venta, finalizar_pedido,
-- anular_venta, editar_pedido, editar_venta, ajustar_stock, persistir_cae_y_
-- marcar_emitida, guardar_pedido, importar_productos_bulk, sa_*) se aplican
-- al final como STUBS con comentario que apunta al código original Loom Point.
-- Tomás debe portarlas manualmente o copiarlas desde el dump de Supabase del
-- proyecto Loom Point. El schema base alcanza para hacer queries directas.
--
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'vendedor');
CREATE TYPE canal_venta AS ENUM ('mostrador', 'pedido', 'online');
CREATE TYPE venta_estado AS ENUM ('abierta', 'guardada', 'cerrada', 'anulada');
CREATE TYPE tipo_factura AS ENUM (
  'sin_factura',
  'factura_a',
  'factura_b',
  'factura_c',
  'nota_credito_a',
  'nota_credito_b',
  'nota_debito_a',
  'nota_debito_b'
);
CREATE TYPE cond_iva AS ENUM ('RI', 'MONO', 'CF', 'EX');
CREATE TYPE medio_pago AS ENUM (
  'efectivo',
  'transferencia',
  'deposito',
  'tarjeta_credito',
  'tarjeta_debito',
  'cheque',
  'mercadopago',
  'mercadopago_qr',
  'otro'
);
CREATE TYPE metodo_pago AS ENUM ('efectivo', 'transferencia', 'tarjeta', 'mercadopago');
CREATE TYPE pago_estado AS ENUM ('pendiente', 'confirmado', 'rechazado');
CREATE TYPE factura_tipo AS ENUM ('A', 'B', 'C');
CREATE TYPE afip_resultado AS ENUM (
  'exito',
  'error_negocio',
  'error_red',
  'error_config'
);
CREATE TYPE afip_severidad AS ENUM (
  'reintentable',
  'permanente',
  'requiere_admin'
);
CREATE TYPE estado_facturacion_afip AS ENUM (
  'no_aplica',
  'pendiente_emision',
  'emitida',
  'pendiente_facturacion',
  'error_permanente'
);

-- ============================================================================
-- HELPER: trigger genérico de updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- TABLAS BASE
-- ============================================================================

-- empresas
CREATE TABLE empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  slug text NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true,
  -- Feature flags por tenant. Default {} = todos los features off.
  -- Ver src/lib/features.ts para flags soportados.
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Categoría comercial. 'libreria' = papelería + útiles + arte (Argentina).
  -- Otros valores planeados: 'ropa', 'generico'.
  rubro text NOT NULL DEFAULT 'libreria',
  -- Si false (default), las ventas se asocian a una sucursal/caja default
  -- automáticamente. Si true, el flow de caja pregunta sucursal/caja activa.
  multi_sucursal boolean NOT NULL DEFAULT false,
  multi_caja boolean NOT NULL DEFAULT false,
  eliminada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER empresas_set_updated_at BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- usuarios (extiende auth.users; id matchea auth.uid)
CREATE TABLE usuarios (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  email text NOT NULL UNIQUE,
  nombre_completo text NOT NULL DEFAULT '',
  rol user_role NOT NULL DEFAULT 'vendedor',
  activo boolean NOT NULL DEFAULT true,
  ultimo_login_at timestamptz,
  ultimo_login_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usuarios_empresa_idx ON usuarios(empresa_id);
CREATE TRIGGER usuarios_set_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- configuracion fiscal por empresa (1-a-1)
CREATE TABLE configuracion (
  id bigserial PRIMARY KEY,
  empresa_id uuid NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  razon_social text NOT NULL DEFAULT '',
  nombre_fantasia text,
  cuit text NOT NULL DEFAULT '',
  condicion_iva text NOT NULL DEFAULT 'IVA Responsable Inscripto',
  ingresos_brutos text,
  inicio_actividades date,
  domicilio text,
  localidad text,
  provincia text,
  codigo_postal text,
  telefono text,
  email text,
  web text,
  punto_venta_default integer NOT NULL DEFAULT 1,
  puntos_venta integer[] NOT NULL DEFAULT '{1}',
  umbral_stock_bajo integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES usuarios(id)
);

-- audit_log
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_email_snapshot text,
  entidad text NOT NULL,
  entidad_id text,
  accion text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  motivo_superadmin text,
  es_accion_superadmin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_empresa_created_idx ON audit_log(empresa_id, created_at DESC);
CREATE INDEX audit_log_entidad_idx ON audit_log(entidad, entidad_id);

-- catalogo_categorias
CREATE TABLE catalogo_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre_normalizado)
);
CREATE TRIGGER catalogo_categorias_set_updated_at BEFORE UPDATE ON catalogo_categorias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- categoria_atributos
-- Cada categoría define qué atributos espera (color, formato, gramaje, etc.)
-- y de qué tipo. El form de creación de productos lee esta tabla para
-- renderizar fields dinámicos por variante.
CREATE TABLE categoria_atributos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL REFERENCES catalogo_categorias(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'numero', 'seleccion')),
  -- Lista de valores válidos cuando tipo='seleccion'. Null en otros tipos.
  opciones jsonb,
  obligatorio boolean NOT NULL DEFAULT false,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, categoria_id, nombre)
);
CREATE INDEX categoria_atributos_categoria_idx ON categoria_atributos(categoria_id);
CREATE TRIGGER categoria_atributos_set_updated_at BEFORE UPDATE ON categoria_atributos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- clientes
CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  razon_social text NOT NULL,
  cuit text,
  email text,
  telefono text,
  domicilio text,
  localidad text,
  provincia text,
  codigo_postal text,
  cond_iva cond_iva NOT NULL DEFAULT 'CF',
  consentimiento_marketing boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuarios(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clientes_empresa_idx ON clientes(empresa_id);
CREATE TRIGGER clientes_set_updated_at BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- productos
CREATE TABLE productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sku_base text NOT NULL UNIQUE,
  nombre text NOT NULL,
  categoria text,
  descripcion_corta text,
  descripcion_larga text,
  precio_neto numeric(14, 2) NOT NULL DEFAULT 0,
  alicuota_iva numeric(5, 2) NOT NULL DEFAULT 21,
  track_stock boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  destacado boolean NOT NULL DEFAULT false,
  visible_online boolean NOT NULL DEFAULT false,
  imagen_url text,
  imagenes text[] NOT NULL DEFAULT '{}',
  meta_titulo text,
  meta_descripcion text,
  slug text,
  peso_gramos integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX productos_empresa_idx ON productos(empresa_id);
CREATE TRIGGER productos_set_updated_at BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- variantes
-- Generaliza el viejo (color, talle) en jsonb arbitrario de atributos.
CREATE TABLE variantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  atributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku_variante text,
  precio_neto_override numeric(14, 2),
  stock integer NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variantes_producto_idx ON variantes(producto_id);
CREATE INDEX variantes_empresa_idx ON variantes(empresa_id);
CREATE UNIQUE INDEX variantes_sku_unq ON variantes(sku_variante) WHERE sku_variante IS NOT NULL;
CREATE TRIGGER variantes_set_updated_at BEFORE UPDATE ON variantes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ventas
CREATE TABLE ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero bigserial NOT NULL,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  canal canal_venta NOT NULL DEFAULT 'mostrador',
  estado venta_estado NOT NULL DEFAULT 'abierta',
  tipo_factura tipo_factura NOT NULL DEFAULT 'sin_factura',
  estado_facturacion_afip estado_facturacion_afip NOT NULL DEFAULT 'no_aplica',
  subtotal_neto numeric(14, 2) NOT NULL DEFAULT 0,
  descuento_total numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  monto_facturado numeric(14, 2) NOT NULL DEFAULT 0,
  -- Recargo opcional (feature flag empresas.features.recargo_manual_habilitado).
  recargo_factura_completa boolean NOT NULL DEFAULT false,
  recargo_motivo text,
  recargo_porcentaje_manual numeric(5, 2),
  nota_interna text,
  nombre_cliente_custom text,
  -- Caja/Sucursal donde se hizo la venta. Default = caja/sucursal default
  -- de la empresa (cuando multi_sucursal/multi_caja están en false).
  caja_id uuid,
  sucursal_id uuid,
  closed_at timestamptz,
  creada_desde_ip inet,
  vista_at timestamptz,
  ultimo_request_log_id bigint,
  ultimo_error_facturacion text,
  ultimo_intento_facturacion_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ventas_empresa_estado_idx ON ventas(empresa_id, estado, created_at DESC);
CREATE INDEX ventas_cliente_idx ON ventas(cliente_id);
CREATE INDEX ventas_usuario_idx ON ventas(usuario_id);
CREATE INDEX ventas_pendientes_facturacion_idx
  ON ventas(empresa_id, ultimo_intento_facturacion_at DESC)
  WHERE estado_facturacion_afip IN ('pendiente_emision', 'pendiente_facturacion');
CREATE TRIGGER ventas_set_updated_at BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- items_venta — snapshot de variantes vendidas
-- variante_atributos jsonb reemplaza el viejo par (variante_color, variante_talle).
CREATE TABLE items_venta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  venta_id uuid NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  variante_id uuid NOT NULL REFERENCES variantes(id) ON DELETE RESTRICT,
  producto_nombre text NOT NULL,
  producto_sku text NOT NULL,
  variante_sku text NOT NULL,
  variante_atributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  cantidad integer NOT NULL,
  precio_unitario_neto numeric(14, 2) NOT NULL,
  subtotal_neto numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_venta_venta_idx ON items_venta(venta_id);
CREATE INDEX items_venta_empresa_idx ON items_venta(empresa_id);

-- medios_pago_venta
CREATE TABLE medios_pago_venta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  venta_id uuid NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  medio medio_pago NOT NULL,
  monto numeric(14, 2) NOT NULL,
  referencia text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medios_pago_venta_venta_idx ON medios_pago_venta(venta_id);
CREATE INDEX medios_pago_venta_empresa_idx ON medios_pago_venta(empresa_id);

-- pagos (Mercado Pago)
CREATE TABLE pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  venta_id uuid REFERENCES ventas(id) ON DELETE SET NULL,
  metodo metodo_pago NOT NULL,
  monto numeric(14, 2) NOT NULL,
  estado pago_estado NOT NULL DEFAULT 'pendiente',
  mp_payment_id text,
  mp_order_id text,
  mp_qr_data text,
  mp_status_detail text,
  mp_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagos_mp_payment_id_idx ON pagos(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
CREATE INDEX pagos_empresa_idx ON pagos(empresa_id);

-- facturas (legacy pre-AFIP; mantenido por compatibilidad)
CREATE TABLE facturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  venta_id uuid NOT NULL UNIQUE REFERENCES ventas(id) ON DELETE CASCADE,
  numero bigint NOT NULL,
  punto_venta integer NOT NULL,
  tipo factura_tipo NOT NULL,
  cae text NOT NULL,
  cae_vto date NOT NULL,
  cliente_razon_social text NOT NULL,
  cliente_cuit text,
  cliente_cond_iva cond_iva NOT NULL,
  monto_neto numeric(14, 2) NOT NULL,
  monto_iva numeric(14, 2) NOT NULL,
  monto_total numeric(14, 2) NOT NULL,
  porcentaje_facturado numeric(5, 2) NOT NULL DEFAULT 100,
  pdf_path text,
  xml_request text,
  xml_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuarios(id)
);

-- facturas_afip — emisión electrónica AFIP
CREATE TABLE facturas_afip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  venta_id uuid NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  tipo_factura tipo_factura NOT NULL,
  punto_venta integer NOT NULL,
  numero_comprobante bigint,
  -- Estado del comprobante AFIP (no del enum estado_facturacion_afip).
  -- Valores: 'pendiente', 'aprobada', 'aprobada_sin_persistir', 'rechazada',
  -- 'error', 'anulada_por_nc'.
  estado text NOT NULL DEFAULT 'pendiente',
  cae text,
  cae_vencimiento date,
  factura_asociada_id uuid REFERENCES facturas_afip(id) ON DELETE SET NULL,
  error_mensaje text,
  intentos integer NOT NULL DEFAULT 0,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facturas_afip_venta_idx ON facturas_afip(venta_id);
CREATE INDEX facturas_afip_empresa_idx ON facturas_afip(empresa_id);
-- Solo puede haber UNA factura "original viva" por venta (no NC/ND).
CREATE UNIQUE INDEX facturas_afip_unq_original_viva
  ON facturas_afip(venta_id)
  WHERE factura_asociada_id IS NULL
    AND estado IN ('aprobada', 'aprobada_sin_persistir', 'anulada_por_nc');
CREATE TRIGGER facturas_afip_set_updated_at BEFORE UPDATE ON facturas_afip
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- afip_ta_cache — token cache WSAA
CREATE TABLE afip_ta_cache (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  service text NOT NULL,
  modo text NOT NULL,
  cuit text NOT NULL,
  token text NOT NULL,
  sign text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, service, modo)
);
CREATE INDEX afip_ta_cache_expires_at_idx ON afip_ta_cache(expires_at);
CREATE TRIGGER afip_ta_cache_set_updated_at BEFORE UPDATE ON afip_ta_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- afip_request_log — auditoría de llamadas WSAA/WSFE
CREATE TABLE afip_request_log (
  id bigserial PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  modo text NOT NULL,
  servicio text NOT NULL,
  metodo text NOT NULL,
  endpoint text,
  intento integer NOT NULL DEFAULT 1,
  request_xml text,
  response_xml text,
  http_status integer,
  duracion_ms integer NOT NULL DEFAULT 0,
  resultado afip_resultado NOT NULL,
  codigos_error integer[],
  severidad_max afip_severidad,
  error_clase text,
  error_mensaje text,
  contexto jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX afip_request_log_empresa_created_idx ON afip_request_log(empresa_id, created_at DESC);
CREATE INDEX afip_request_log_errores_idx ON afip_request_log(empresa_id, created_at DESC)
  WHERE resultado <> 'exito';
CREATE INDEX afip_request_log_metodo_idx ON afip_request_log(metodo, created_at DESC);

-- FK que apunta a afip_request_log (definida después porque era forward ref)
ALTER TABLE ventas
  ADD CONSTRAINT ventas_ultimo_request_log_fk
  FOREIGN KEY (ultimo_request_log_id) REFERENCES afip_request_log(id) ON DELETE SET NULL;

-- mp_webhook_events — webhook log de Mercado Pago
CREATE TABLE mp_webhook_events (
  id bigserial PRIMARY KEY,
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  event_id text NOT NULL UNIQUE,
  topic text,
  resource_id text,
  payload jsonb,
  procesado boolean NOT NULL DEFAULT false,
  procesado_at timestamptz,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mp_webhook_events_received_idx ON mp_webhook_events(received_at DESC);

-- ============================================================================
-- VISTAS
-- ============================================================================

CREATE VIEW productos_con_stock_total AS
SELECT
  p.id,
  p.empresa_id,
  p.sku_base,
  p.nombre,
  p.categoria,
  p.descripcion_corta,
  p.precio_neto,
  p.imagen_url,
  p.track_stock,
  p.activo,
  p.created_at,
  COALESCE((
    SELECT SUM(v.stock)::bigint
    FROM variantes v
    WHERE v.producto_id = p.id AND v.activa
  ), 0) AS stock_total,
  COALESCE((
    SELECT SUM(v.stock)::bigint
    FROM variantes v
    WHERE v.producto_id = p.id AND v.activa
  ), 0) <= 5 AS tiene_stock_bajo
FROM productos p;

CREATE VIEW v_usuario_empresa_id AS
SELECT id AS usuario_id, empresa_id
FROM usuarios;

CREATE VIEW v_acciones_superadmin AS
SELECT
  al.id,
  al.created_at,
  al.entidad,
  al.entidad_id,
  al.accion,
  al.detalle,
  al.empresa_id,
  al.ip,
  al.motivo_superadmin,
  u.email AS superadmin_email
FROM audit_log al
LEFT JOIN usuarios u ON u.id = al.usuario_id
WHERE al.es_accion_superadmin = true;

-- ============================================================================
-- RLS (Row Level Security)
-- ============================================================================
-- Patrón general:
--   * SELECT: superadmin ve todo; usuarios comunes ven solo su empresa
--   * INSERT/UPDATE/DELETE: bloqueado para clientes (service_role inserta
--     vía RPC SECURITY DEFINER que valida usuario)
--
-- Para Lemma + Samu el flujo crítico (cerrar_venta, guardar_pedido, etc.)
-- es vía RPC. Las queries directas son SELECT solo.

ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE categoria_atributos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE variantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE medios_pago_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_afip ENABLE ROW LEVEL SECURITY;
ALTER TABLE afip_ta_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE afip_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_webhook_events ENABLE ROW LEVEL SECURITY;

-- FORCE para tablas de auditoría/secrets: NADIE accede desde cliente
ALTER TABLE afip_ta_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE afip_request_log FORCE ROW LEVEL SECURITY;
ALTER TABLE mp_webhook_events FORCE ROW LEVEL SECURITY;

-- Helper: ¿el caller es superadmin?
CREATE OR REPLACE FUNCTION es_superadmin(p_usuario_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE id = p_usuario_id AND rol = 'superadmin' AND activo
  );
$$;
REVOKE EXECUTE ON FUNCTION es_superadmin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION es_superadmin(uuid) TO authenticated, service_role;

-- Helper: empresa_id del caller
CREATE OR REPLACE FUNCTION current_empresa_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM usuarios WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION current_empresa_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_empresa_id() TO authenticated, service_role;

-- Policies SELECT estándar: superadmin ve todo; resto solo su empresa
CREATE POLICY empresas_select ON empresas FOR SELECT
  USING (es_superadmin(auth.uid()) OR id = current_empresa_id());

CREATE POLICY usuarios_select ON usuarios FOR SELECT
  USING (
    es_superadmin(auth.uid())
    OR (empresa_id = current_empresa_id() AND rol <> 'superadmin')
    OR id = auth.uid()
  );

CREATE POLICY configuracion_select ON configuracion FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY catalogo_categorias_select ON catalogo_categorias FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY catalogo_categorias_write ON catalogo_categorias FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY categoria_atributos_select ON categoria_atributos FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY categoria_atributos_write ON categoria_atributos FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY clientes_select ON clientes FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY clientes_write ON clientes FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY productos_select ON productos FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY productos_write ON productos FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY variantes_select ON variantes FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY variantes_write ON variantes FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY ventas_select ON ventas FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY items_venta_select ON items_venta FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY medios_pago_venta_select ON medios_pago_venta FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY pagos_select ON pagos FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY facturas_select ON facturas FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

CREATE POLICY facturas_afip_select ON facturas_afip FOR SELECT
  USING (es_superadmin(auth.uid()) OR empresa_id = current_empresa_id());

-- ============================================================================
-- RPCs operativas — STUBS
-- ============================================================================
--
-- Esta sección define las firmas de las RPCs que el código TS de Lemma invoca
-- vía `supabase.rpc(...)`. Los cuerpos están como STUBS porque reproducir las
-- ~3000 líneas de PL/pgSQL del Loom Point original consume demasiado espacio
-- y debe hacerse con cuidado contra la implementación viva.
--
-- TODO (Tomás): portar el cuerpo desde el dump de Supabase del proyecto
-- Loom Point original o reescribirlas a mano según la lógica de:
--   - src/app/(app)/caja/_actions/cerrar-venta.ts (RPC cerrar_venta)
--   - src/app/(app)/caja/_actions/guardar-pedido.ts (RPC guardar_pedido)
--   - src/app/(app)/admin/pedidos/_actions/editar-pedido.ts (RPC editar_pedido)
--   - src/app/(app)/admin/ventas/_actions/editar-venta.ts (RPC editar_venta)
--   - src/app/(app)/admin/productos/_actions/actualizar-stock.ts (RPC ajustar_stock)
--   - src/app/(app)/admin/ventas/_actions/anular-venta.ts (RPC anular_venta)
--   - src/app/(app)/admin/ventas/_actions/finalizar-pedido (RPC finalizar_pedido)
--   - src/app/(app)/admin/ventas/_actions/emitir-factura-afip.ts (RPC persistir_cae_y_marcar_emitida)
--   - src/app/(app)/admin/productos/_actions/importar-productos.tsx (RPC importar_productos_bulk)
--
-- IMPORTANTE: Cada RPC debe validar `auth.uid() = p_usuario_id` o `auth.uid() IN (...)`
-- al inicio (defense in depth contra abuso de SECURITY DEFINER).

CREATE OR REPLACE FUNCTION cerrar_venta(
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_canal text DEFAULT 'mostrador',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_medios_pago jsonb DEFAULT '[]'::jsonb,
  p_descuento_total numeric DEFAULT 0,
  p_tipo_factura tipo_factura DEFAULT 'sin_factura',
  p_monto_facturado numeric DEFAULT 0,
  p_nota_interna text DEFAULT NULL,
  p_nombre_cliente_custom text DEFAULT NULL,
  p_recargo_factura_completa boolean DEFAULT false,
  p_recargo_motivo text DEFAULT NULL,
  p_recargo_porcentaje_manual numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- STUB: portar desde Loom Point
  RAISE EXCEPTION 'cerrar_venta no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION guardar_pedido(
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_canal text DEFAULT 'mostrador',
  p_items jsonb DEFAULT '[]'::jsonb,
  p_nota_interna text DEFAULT NULL,
  p_nombre_cliente_custom text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'guardar_pedido no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION editar_pedido(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_items_nuevos jsonb,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'editar_pedido no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION editar_venta(
  p_venta_id uuid,
  p_usuario_id uuid,
  p_items_nuevos jsonb,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'editar_venta no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION ajustar_stock(
  p_variante_id uuid,
  p_delta integer,
  p_motivo text,
  p_usuario_id uuid,
  p_permitir_negativo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ajustar_stock no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION anular_venta(
  p_venta_id uuid,
  p_motivo text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'anular_venta no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION finalizar_pedido(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_medios_pago jsonb DEFAULT '[]'::jsonb,
  p_descuento_total numeric DEFAULT 0,
  p_tipo_factura tipo_factura DEFAULT 'sin_factura',
  p_monto_facturado numeric DEFAULT 0,
  p_nota_interna text DEFAULT NULL,
  p_recargo_factura_completa boolean DEFAULT false,
  p_recargo_motivo text DEFAULT NULL,
  p_recargo_porcentaje_manual numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'finalizar_pedido no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION persistir_cae_y_marcar_emitida(
  p_factura_id uuid,
  p_venta_id uuid,
  p_empresa_id uuid,
  p_cae text,
  p_cae_vencimiento date,
  p_numero_comprobante bigint,
  p_raw_response jsonb,
  p_request_log_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'persistir_cae_y_marcar_emitida no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

CREATE OR REPLACE FUNCTION importar_productos_bulk(
  p_usuario_id uuid,
  p_productos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'importar_productos_bulk no implementada en Lemma. Portar desde Loom Point.';
END;
$$;

-- REVOKE de PUBLIC en todas las RPCs (defense in depth)
REVOKE EXECUTE ON FUNCTION cerrar_venta FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guardar_pedido FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION editar_pedido FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION editar_venta FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ajustar_stock FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION anular_venta FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION finalizar_pedido FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION persistir_cae_y_marcar_emitida FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION importar_productos_bulk FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cerrar_venta TO authenticated;
GRANT EXECUTE ON FUNCTION guardar_pedido TO authenticated;
GRANT EXECUTE ON FUNCTION editar_pedido TO authenticated;
GRANT EXECUTE ON FUNCTION editar_venta TO authenticated;
GRANT EXECUTE ON FUNCTION ajustar_stock TO authenticated;
GRANT EXECUTE ON FUNCTION anular_venta TO authenticated;
GRANT EXECUTE ON FUNCTION finalizar_pedido TO authenticated;
GRANT EXECUTE ON FUNCTION persistir_cae_y_marcar_emitida TO authenticated;
GRANT EXECUTE ON FUNCTION importar_productos_bulk TO authenticated;
