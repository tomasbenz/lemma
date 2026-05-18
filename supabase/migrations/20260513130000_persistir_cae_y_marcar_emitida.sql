-- ============================================================
-- Atomicidad de persistencia CAE + marcado de venta emitida
--
-- Finding HIGH #3 de auditoria 184dc76:
-- emitir-factura-afip.ts hacia UPDATE facturas_afip + UPDATE ventas
-- como dos operaciones separadas. Crash entre ambas dejaba CAE
-- persistido pero venta marcada como pendiente — inconsistencia
-- visible al admin sin via clara de resolucion.
--
-- Esta funcion encapsula ambos UPDATEs en una transaccion implicita
-- (PL/pgSQL es siempre transaccional). Si cualquiera falla, rollback
-- automatico — el server action recibe el error y maneja segun el
-- SQLSTATE (23505 race condition vs otros).
--
-- SECURITY DEFINER: mismo patron que cerrar_venta, anular_venta,
-- finalizar_pedido, etc. Permite operar sobre tablas con RLS desde
-- el server action sin necesidad de que el rol del caller tenga
-- grants directos a UPDATE.
--
-- Validacion multitenant defensiva: filtra empresa_id en ambos
-- UPDATEs. Si el caller pasa una factura_id o venta_id de otra
-- empresa por error, ningun UPDATE matchea y la funcion levanta
-- excepcion — rollback de lo que se haya hecho previamente.
--
-- request_log_id es bigint (no uuid): afip_request_log.id es
-- bigserial, ver migration 20260506232044_create_afip_request_log.
-- ============================================================

CREATE OR REPLACE FUNCTION public.persistir_cae_y_marcar_emitida(
  p_factura_id uuid,
  p_venta_id uuid,
  p_empresa_id uuid,
  p_cae text,
  p_cae_vencimiento date,
  p_numero_comprobante bigint,
  p_raw_response jsonb,
  p_request_log_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factura_actualizada uuid;
  v_venta_actualizada uuid;
BEGIN
  -- Defensa: el server action ya autentico, pero validamos que haya
  -- contexto auth para evitar invocaciones desde scripts no auditados.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- UPDATE 1: persistir CAE en facturas_afip.
  -- Si el UNIQUE INDEX (idx_facturas_afip_una_aprobada_por_venta)
  -- detecta race condition, esto tira SQLSTATE 23505 y la transaccion
  -- entera hace rollback. El caller TS distingue via
  -- detectarErrorUniqueConstraint().
  UPDATE public.facturas_afip
  SET estado = 'aprobada',
      cae = p_cae,
      cae_vencimiento = p_cae_vencimiento,
      numero_comprobante = p_numero_comprobante,
      raw_response = p_raw_response,
      error_mensaje = NULL,
      updated_at = NOW()
  WHERE id = p_factura_id
    AND empresa_id = p_empresa_id
  RETURNING id INTO v_factura_actualizada;

  IF v_factura_actualizada IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada o no pertenece a empresa %', p_factura_id, p_empresa_id;
  END IF;

  -- UPDATE 2: marcar venta como emitida. Misma semantica que
  -- recovery.ts/marcarVentaEmitida (que sigue disponible para otros
  -- callers que no necesitan atomicidad con facturas_afip).
  UPDATE public.ventas
  SET estado_facturacion_afip = 'emitida',
      ultimo_request_log_id = p_request_log_id,
      ultimo_error_facturacion = NULL,
      ultimo_intento_facturacion_at = NOW(),
      updated_at = NOW()
  WHERE id = p_venta_id
    AND empresa_id = p_empresa_id
  RETURNING id INTO v_venta_actualizada;

  IF v_venta_actualizada IS NULL THEN
    -- Si la venta no existe o es de otra empresa, rollback automatico
    -- por la excepcion. La factura tampoco persiste, lo cual es bueno
    -- para evitar CAE huerfano en DB.
    RAISE EXCEPTION 'Venta % no encontrada o no pertenece a empresa %', p_venta_id, p_empresa_id;
  END IF;

  -- Ambos UPDATEs OK. PL/pgSQL hace commit implicito al retornar.
END;
$function$;

COMMENT ON FUNCTION public.persistir_cae_y_marcar_emitida IS
  'Atomicidad de persistencia CAE: UPDATE facturas_afip + UPDATE ventas en una sola transaccion. Finding HIGH #3 auditoria 184dc76.';
