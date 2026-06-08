-- ============================================================================
-- 00000000000026_eliminar_producto.sql
-- ----------------------------------------------------------------------------
-- RPC eliminar_producto: eliminación de un producto del catálogo con razón
-- obligatoria y auditoría completa.
--
-- DOBLE COMPORTAMIENTO (transparente al usuario):
--   * Producto SIN ventas asociadas  -> DELETE físico (hard delete).
--     El FK variantes.producto_id ON DELETE CASCADE arrastra las variantes,
--     y operaciones_masivas_precio_detalle.producto_id ON DELETE CASCADE
--     arrastra el detalle de aumentos. Borrado real, irreversible.
--   * Producto CON ventas asociadas  -> UPDATE activo=false (soft delete).
--     El producto deja de aparecer en listados/caja pero sigue en DB para que
--     los reportes históricos no se rompan.
--
-- RED DE SEGURIDAD (anti-TOCTOU): el FK items_venta.variante_id ON DELETE
-- RESTRICT es la garantía REAL. El conteo de ventas decide el camino feliz,
-- pero si entra una venta entre el COUNT y el DELETE, el foreign_key_violation
-- se captura y cae a soft delete automáticamente. No hay lost-delete posible.
--
-- AUDITORÍA: registra en operaciones_masivas (accion='eliminar_producto') la
-- razón, el modo final (hard/soft), el count de ventas y un SNAPSHOT del
-- producto (nombre, sku, precio, costo, marca, categoría) tomado ANTES de
-- mutar nada — así queda trazabilidad incluso después de un hard delete.
--
-- IMPORTANTE: esta migración NO se aplica automáticamente. Tomás la aplica a
-- mano en la DB de prod. Después de aplicarla hay que correr `npm run db:types`
-- para regenerar src/types/database.ts; recién ahí compila el código TS del
-- commit 2 que consume esta RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_producto(
  p_usuario_id uuid,
  p_id uuid,
  p_razon text
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
  v_snapshot jsonb;
  v_count_ventas integer := 0;
  v_modo text;
  v_operacion_id uuid;
BEGIN
  -- ===== Auth =====
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'p_usuario_id no coincide con el usuario autenticado';
  END IF;
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo admin puede eliminar productos';
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

  -- ===== Validación de razón =====
  v_razon := TRIM(COALESCE(p_razon, ''));
  IF length(v_razon) = 0 THEN
    RAISE EXCEPTION 'La razón es obligatoria';
  END IF;
  IF length(v_razon) > 200 THEN
    RAISE EXCEPTION 'La razón no puede superar 200 caracteres';
  END IF;

  -- ===== Snapshot del producto (ANTES de mutar) + pre-check pertenencia =====
  -- El filtro por empresa_id hace que un id de otra empresa caiga en NOT FOUND,
  -- con el mismo mensaje genérico que un id inexistente (no filtra existencia).
  SELECT jsonb_build_object(
    'nombre', p.nombre,
    'sku_base', p.sku_base,
    'precio_neto', p.precio_neto,
    'costo', p.costo,
    'activo_antes', p.activo,
    'marca_nombre', m.nombre,
    'categoria_nombre', c.nombre
  )
  INTO v_snapshot
  FROM public.productos p
  LEFT JOIN public.marcas m ON m.id = p.marca_id
  LEFT JOIN public.catalogo_categorias c ON c.id = p.categoria_id
  WHERE p.id = p_id AND p.empresa_id = v_empresa_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'El producto no existe';
  END IF;

  -- ===== Conteo de ventas (para el mensaje, no para la decisión final) =====
  -- items_venta existe para ventas cerradas Y borradores (estado='guardada'),
  -- así que cubre ambos casos.
  SELECT COUNT(DISTINCT iv.venta_id) INTO v_count_ventas
  FROM public.items_venta iv
  JOIN public.variantes v ON v.id = iv.variante_id
  WHERE v.producto_id = p_id AND iv.empresa_id = v_empresa_id;

  -- ===== Decisión hard/soft con RESTRICT como red de seguridad =====
  IF v_count_ventas = 0 THEN
    BEGIN
      DELETE FROM public.productos
      WHERE id = p_id AND empresa_id = v_empresa_id;
      v_modo := 'hard';
    EXCEPTION
      WHEN foreign_key_violation THEN
        -- Race: entró una venta entre el COUNT y el DELETE. Caemos a soft.
        UPDATE public.productos
        SET activo = false
        WHERE id = p_id AND empresa_id = v_empresa_id;
        v_modo := 'soft';
        -- Re-contar para que el mensaje refleje la realidad.
        SELECT COUNT(DISTINCT iv.venta_id) INTO v_count_ventas
        FROM public.items_venta iv
        JOIN public.variantes v ON v.id = iv.variante_id
        WHERE v.producto_id = p_id AND iv.empresa_id = v_empresa_id;
    END;
  ELSE
    UPDATE public.productos
    SET activo = false
    WHERE id = p_id AND empresa_id = v_empresa_id;
    v_modo := 'soft';
  END IF;

  -- ===== Auditoría (misma tx) =====
  INSERT INTO public.operaciones_masivas (
    empresa_id, usuario_id, usuario_email_snapshot, accion, parametros,
    total_solicitados, afectados, ids_afectados
  ) VALUES (
    v_empresa_id,
    p_usuario_id,
    COALESCE(v_usuario_email, 'desconocido'),
    'eliminar_producto',
    jsonb_build_object(
      'razon', v_razon,
      'modo', v_modo,
      'ventas', v_count_ventas,
      'snapshot', v_snapshot
    ),
    1,
    1,
    jsonb_build_array(p_id)
  )
  RETURNING id INTO v_operacion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'modo', v_modo,
    'ventas', v_count_ventas,
    'operacion_id', v_operacion_id
  );
END;
$function$;

-- ===== Permisos: defense in depth (Postgres grants + check es_admin() interno) =====
REVOKE EXECUTE ON FUNCTION public.eliminar_producto(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_producto(uuid, uuid, text) TO authenticated;
