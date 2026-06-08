-- ============================================================================
-- 00000000000027_cambiar_precio_caja.sql
-- ----------------------------------------------------------------------------
-- RPC cambiar_precio_producto_caja: permite que un vendedor cambie el precio
-- de un producto desde el carrito de /caja. El cambio PERSISTE al catálogo
-- (productos.precio_neto), así que futuras ventas de cualquier caja/flujo usan
-- el precio nuevo.
--
-- SCOPE: afecta a TODO el producto. precio_neto vive en productos (no en
-- variantes), así que el cambio impacta todas las variantes del producto.
--
-- PERMISOS — DECISIÓN CONSCIENTE: esta RPC NO usa es_admin(). Cualquier
-- vendedor con acceso a caja puede cambiar precios (pedido explícito de Samu).
-- Es el PRIMER writer de operaciones_masivas invocable por vendedores; todos
-- los demás exigen es_admin(). El único check de identidad es
-- auth.uid() = p_usuario_id + que el usuario pertenezca a una empresa activa.
-- La MITIGACIÓN contra fraude/error es el AUDIT obligatorio en
-- operaciones_masivas (accion='cambio_precio_caja') + el reporte filtrable en
-- /admin/operaciones, no un gate de rol.
--
-- AUDIT: registra producto_id, precio_anterior, precio_nuevo, razón (opcional),
-- venta_id_en_curso (informacional; hoy siempre NULL porque la fila en ventas
-- recién existe al cerrar la venta) y el snapshot del email del vendedor.
--
-- IMPORTANTE: esta migración NO se aplica automáticamente. Tomás la aplica a
-- mano en prod. Después hay que correr `npm run db:types` para regenerar
-- src/types/database.ts; recién ahí compila el código TS del commit 2.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cambiar_precio_producto_caja(
  p_usuario_id uuid,
  p_producto_id uuid,
  p_precio_nuevo numeric,
  p_razon text,
  p_venta_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_usuario_email text;
  v_razon text;
  v_precio_nuevo numeric;
  v_precio_anterior numeric;
  v_operacion_id uuid;
BEGIN
  -- ===== Auth (SIN es_admin: vendedores habilitados) =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;

  -- ===== Empresa + email (re-derivados, no se confía en el cliente) =====
  SELECT empresa_id, email INTO v_empresa_id, v_usuario_email
  FROM public.usuarios
  WHERE id = p_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin empresa asignada';
  END IF;

  -- ===== Validación de parámetros =====
  -- Razón opcional: trim; vacío => NULL. Cap 200.
  v_razon := NULLIF(TRIM(COALESCE(p_razon, '')), '');
  IF v_razon IS NOT NULL AND length(v_razon) > 200 THEN
    RAISE EXCEPTION 'La razón no puede superar 200 caracteres';
  END IF;

  -- Precio: finito y > 0. En SQL numeric no hay NaN/Infinity de floats del
  -- cliente (se castea a numeric), pero validamos > 0 explícitamente.
  IF p_precio_nuevo IS NULL OR p_precio_nuevo <= 0 THEN
    RAISE EXCEPTION 'Precio inválido';
  END IF;
  v_precio_nuevo := round(p_precio_nuevo, 2);

  -- ===== Pre-check pertenencia + capturar precio anterior =====
  -- El filtro por empresa_id hace que un id de otra empresa caiga en NOT FOUND
  -- con el mismo mensaje genérico que un id inexistente (no filtra existencia).
  SELECT precio_neto INTO v_precio_anterior
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe';
  END IF;

  -- ===== UPDATE del precio =====
  UPDATE public.productos
  SET precio_neto = v_precio_nuevo,
      updated_at = now()
  WHERE id = p_producto_id AND empresa_id = v_empresa_id;

  -- ===== Auditoría (misma tx) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, ids_afectados
  ) VALUES (
    v_empresa_id,
    p_usuario_id,
    COALESCE(v_usuario_email, 'desconocido'),
    'cambio_precio_caja',
    jsonb_build_object(
      'producto_id', p_producto_id,
      'precio_anterior', v_precio_anterior,
      'precio_nuevo', v_precio_nuevo,
      'razon', v_razon,                 -- puede ser NULL
      'venta_id_en_curso', p_venta_id   -- puede ser NULL
    ),
    1,
    1,
    jsonb_build_array(p_producto_id)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'precio_anterior', v_precio_anterior,
    'precio_nuevo', v_precio_nuevo,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ===== Permisos: defense in depth (Postgres grants + check auth interno) =====
REVOKE EXECUTE ON FUNCTION public.cambiar_precio_producto_caja(uuid, uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cambiar_precio_producto_caja(uuid, uuid, numeric, text, uuid) TO authenticated;
