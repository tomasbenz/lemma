-- ============================================================
-- Sprint 3: agregar 'factura_b' al enum tipo_factura y
-- 'aprobada_sin_persistir' al CHECK de facturas_afip.estado.
--
-- Contexto:
-- 1. La cajera ya no elige tipo de comprobante. El sistema deriva A
--    o B segun cond_iva del cliente. Iconic (RI) emite A para
--    receptores RI/MONO con CUIT, y B para CF/EX o sin cliente. El
--    valor 'factura_c' queda solo como backcompat de ventas
--    historicas de homologacion.
-- 2. El UPDATE que persiste el CAE en facturas_afip puede fallar
--    (RLS, constraint, error transitorio de DB). Antes el codigo
--    continuaba y la factura quedaba aprobada en AFIP pero sin CAE
--    en DB. Ahora si el UPDATE falla tras 2 intentos, el registro
--    pasa a 'aprobada_sin_persistir' para reconciliacion manual.
--
-- No requiere migracion de datos: las pocas filas con 'factura_c'
-- son tests de homologacion que seran limpiados antes del switch a
-- produccion.
-- ============================================================

-- 1. Agregar value al enum.
-- Notar: aunque la columna facturas_afip.tipo_factura usa el mismo
-- enum, no hace falta migracion de datos — solo extiende el dominio.
ALTER TYPE tipo_factura ADD VALUE IF NOT EXISTS 'factura_b';

-- 2. Extender CHECK de estado en facturas_afip con
--    'aprobada_sin_persistir'.
-- El constraint existe (definido en 20260507180001_nc_nd_schema.sql).
-- Lo droppeamos y recreamos con el value adicional.
ALTER TABLE facturas_afip
  DROP CONSTRAINT IF EXISTS facturas_afip_estado_check;

ALTER TABLE facturas_afip
  ADD CONSTRAINT facturas_afip_estado_check CHECK (
    estado = ANY (ARRAY[
      'pendiente'::text,
      'aprobada'::text,
      'rechazada'::text,
      'error'::text,
      'anulada_por_nc'::text,
      'aprobada_sin_persistir'::text
    ])
  );

COMMENT ON COLUMN facturas_afip.estado IS
  'pendiente=en proceso | aprobada=CAE valido | rechazada=AFIP rechazo | error=falla tecnica | anulada_por_nc=anulada por NC posterior | aprobada_sin_persistir=AFIP aprobo pero el UPDATE de CAE fallo, requiere reconciliacion manual';
