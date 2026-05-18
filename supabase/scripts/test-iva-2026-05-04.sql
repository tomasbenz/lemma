-- ============================================================
-- TEST IVA — modelo nuevo (precios netos + recargo 10,5% opcional)
-- Fecha: 2026-05-04
-- Marker: TEST_IVA_2026_05_04
-- ============================================================
--
-- Cómo funciona:
--   1. IDs hardcoded (usuario admin, variante, empresa Design Plus).
--   2. Single SELECT para traer datos derivados de la variante
--      (nombre/sku/color/talle, precio efectivo y stock inicial)
--      + cliente cualquiera de la empresa.
--   3. Spoof de auth.uid() vía set_config('request.jwt.claims', ..., true).
--      Transaction-local, no contamina la sesión del SQL Editor.
--   4. Expected calculados dinámicamente desde el precio real:
--        T1 sin factura          → total=P,                 facturado=0
--        T2 factura A 30%        → total=P,                 facturado=round(P*0.30,2)
--        T3 factura A 100%       → total=P,                 facturado=P
--        T4 recargo              → total=round(P*1.105,2),  facturado=total
--        T5 descuento 10%+recargo→ desc=round(P*0.10,2)
--                                  total=round((P-desc)*1.105,2)
--                                  facturado=total
--        T6 factura C 100%       → total=P,                 facturado=P
--   5. ASSERT por test. Si alguno falla, ROLLBACK total y stock se restaura.
--   6. Verificación final: stock_actual = stock_inicial - 6.
--
-- Cleanup (correr aparte cuando termines de validar visualmente):
--   -- Ver test ventas:
--   SELECT id, numero, nota_interna, total, monto_facturado
--   FROM ventas WHERE nota_interna LIKE 'TEST_IVA_2026_05_04%' ORDER BY created_at;
--   -- Anular cada una para restaurar stock y dejar trazabilidad:
--   --   SELECT anular_venta(<id>, 'cleanup test IVA 2026-05-04');
-- ============================================================

DO $$
DECLARE
  v_empresa_id        uuid    := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_usuario_id        uuid    := '31f1faec-ea0e-4508-91b8-7c003dc2f316';
  v_variante_id       uuid    := '5c308eab-ff01-4d2b-b66a-b138dca99d38';
  v_marker            text    := 'TEST_IVA_2026_05_04';

  -- Datos derivados de la variante
  v_producto_id       uuid;
  v_producto_nombre   text;
  v_producto_sku      text;
  v_variante_sku      text;
  v_variante_color    text;
  v_variante_talle    text;
  v_precio            numeric;
  v_stock_inicial     int;
  v_stock_final       int;
  v_cliente_id        uuid;

  -- Expected calculados desde el precio real
  v_t2_facturado      numeric;
  v_t4_total          numeric;
  v_t5_descuento      numeric;
  v_t5_total          numeric;

  -- Args y outputs por test
  v_items             jsonb;
  v_medios            jsonb;
  v_result            jsonb;
  v_venta_id          uuid;
  r                   record;
BEGIN
  -- ---------- Discovery (solo datos derivados) ----------
  SELECT v.producto_id,
         p.nombre,
         p.sku_base,
         v.sku_variante,
         v.color,
         v.talle,
         COALESCE(v.precio_neto_override, p.precio_neto),
         v.stock
    INTO v_producto_id, v_producto_nombre, v_producto_sku,
         v_variante_sku, v_variante_color, v_variante_talle,
         v_precio, v_stock_inicial
    FROM variantes v
    JOIN productos p ON p.id = v.producto_id
   WHERE v.id = v_variante_id
     AND v.empresa_id = v_empresa_id;

  IF v_producto_id IS NULL THEN
    RAISE EXCEPTION 'Variante % no existe o no pertenece a empresa %',
      v_variante_id, v_empresa_id;
  END IF;
  IF v_stock_inicial < 6 THEN
    RAISE EXCEPTION 'Stock insuficiente: hay % unidades, hacen falta 6', v_stock_inicial;
  END IF;
  IF v_precio IS NULL OR v_precio <= 0 THEN
    RAISE EXCEPTION 'Precio inválido para la variante: %', v_precio;
  END IF;

  SELECT id INTO v_cliente_id
    FROM clientes
   WHERE empresa_id = v_empresa_id
   LIMIT 1;

  RAISE NOTICE '----------------------------------------';
  RAISE NOTICE 'Setup OK';
  RAISE NOTICE '  empresa_id     = %', v_empresa_id;
  RAISE NOTICE '  usuario_id     = %', v_usuario_id;
  RAISE NOTICE '  variante_id    = %', v_variante_id;
  RAISE NOTICE '  producto       = % (%)', v_producto_nombre, v_producto_sku;
  RAISE NOTICE '  precio_neto    = %', v_precio;
  RAISE NOTICE '  stock_inicial  = %', v_stock_inicial;
  RAISE NOTICE '  cliente_id     = %', COALESCE(v_cliente_id::text, '<NULL>');
  RAISE NOTICE '----------------------------------------';

  -- ---------- Expected dinámicos ----------
  v_t2_facturado := round(v_precio * 0.30, 2);
  v_t4_total     := round(v_precio * 1.105, 2);
  v_t5_descuento := round(v_precio * 0.10, 2);
  v_t5_total     := round((v_precio - v_t5_descuento) * 1.105, 2);

  RAISE NOTICE 'Expected:';
  RAISE NOTICE '  T1 sin factura  → total=% facturado=0', v_precio;
  RAISE NOTICE '  T2 fact A 30%%   → total=% facturado=%', v_precio, v_t2_facturado;
  RAISE NOTICE '  T3 fact A 100%% → total=% facturado=%', v_precio, v_precio;
  RAISE NOTICE '  T4 recargo     → total=% facturado=%', v_t4_total, v_t4_total;
  RAISE NOTICE '  T5 desc+rec    → desc=% total=% facturado=%', v_t5_descuento, v_t5_total, v_t5_total;
  RAISE NOTICE '  T6 fact C      → total=% facturado=%', v_precio, v_precio;
  RAISE NOTICE '----------------------------------------';

  -- ---------- Spoof auth.uid() ----------
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_usuario_id::text, 'role', 'authenticated')::text,
    true   -- transaction-local
  );

  RAISE NOTICE 'auth.uid() = %', auth.uid();
  IF auth.uid() IS DISTINCT FROM v_usuario_id THEN
    RAISE EXCEPTION 'Spoof falló: auth.uid()=% esperado=%', auth.uid(), v_usuario_id;
  END IF;

  -- ============================================================
  -- TEST 1 — Sin factura
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_precio, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => 0,
    p_tipo_factura          => 'sin_factura'::tipo_factura,
    p_monto_facturado       => 0,
    p_nota_interna          => v_marker || ' — Test 1: Sin factura',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => false
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T1 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = 0,
    format('T1 descuento_total: esperado 0, got %s', r.descuento_total);
  ASSERT r.total = v_precio,
    format('T1 total: esperado %s, got %s', v_precio, r.total);
  ASSERT r.monto_facturado = 0,
    format('T1 monto_facturado: esperado 0, got %s', r.monto_facturado);
  ASSERT r.recargo_iva_reducido = false,
    format('T1 recargo: esperado false, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'sin_factura',
    format('T1 tipo_factura: esperado sin_factura, got %s', r.tipo_factura);
  RAISE NOTICE '[T1] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- TEST 2 — Factura A 30%
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_precio, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => 0,
    p_tipo_factura          => 'factura_a'::tipo_factura,
    p_monto_facturado       => v_t2_facturado,
    p_nota_interna          => v_marker || ' — Test 2: Factura A 30%',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => false
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T2 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = 0,
    format('T2 descuento_total: esperado 0, got %s', r.descuento_total);
  ASSERT r.total = v_precio,
    format('T2 total: esperado %s, got %s', v_precio, r.total);
  ASSERT abs(r.monto_facturado - v_t2_facturado) < 0.01,
    format('T2 monto_facturado: esperado %s, got %s', v_t2_facturado, r.monto_facturado);
  ASSERT r.recargo_iva_reducido = false,
    format('T2 recargo: esperado false, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'factura_a',
    format('T2 tipo_factura: esperado factura_a, got %s', r.tipo_factura);
  RAISE NOTICE '[T2] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- TEST 3 — Factura A 100%
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_precio, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => 0,
    p_tipo_factura          => 'factura_a'::tipo_factura,
    p_monto_facturado       => v_precio,
    p_nota_interna          => v_marker || ' — Test 3: Factura A 100%',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => false
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T3 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = 0,
    format('T3 descuento_total: esperado 0, got %s', r.descuento_total);
  ASSERT r.total = v_precio,
    format('T3 total: esperado %s, got %s', v_precio, r.total);
  ASSERT r.monto_facturado = v_precio,
    format('T3 monto_facturado: esperado %s, got %s', v_precio, r.monto_facturado);
  ASSERT r.recargo_iva_reducido = false,
    format('T3 recargo: esperado false, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'factura_a',
    format('T3 tipo_factura: esperado factura_a, got %s', r.tipo_factura);
  RAISE NOTICE '[T3] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- TEST 4 — Factura A 100% + recargo 10,5%
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_t4_total, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => 0,
    p_tipo_factura          => 'factura_a'::tipo_factura,
    p_monto_facturado       => v_t4_total,
    p_nota_interna          => v_marker || ' — Test 4: Factura A 100% + recargo',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => true
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T4 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = 0,
    format('T4 descuento_total: esperado 0, got %s', r.descuento_total);
  ASSERT abs(r.total - v_t4_total) < 0.01,
    format('T4 total: esperado %s, got %s', v_t4_total, r.total);
  ASSERT abs(r.monto_facturado - v_t4_total) < 0.01,
    format('T4 monto_facturado: esperado %s, got %s', v_t4_total, r.monto_facturado);
  ASSERT r.recargo_iva_reducido = true,
    format('T4 recargo: esperado true, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'factura_a',
    format('T4 tipo_factura: esperado factura_a, got %s', r.tipo_factura);
  RAISE NOTICE '[T4] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- TEST 5 — Descuento 10% + recargo 10,5%
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_t5_total, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => v_t5_descuento,
    p_tipo_factura          => 'factura_a'::tipo_factura,
    p_monto_facturado       => v_t5_total,
    p_nota_interna          => v_marker || ' — Test 5: Descuento 10% + recargo',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => true
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T5 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = v_t5_descuento,
    format('T5 descuento_total: esperado %s, got %s', v_t5_descuento, r.descuento_total);
  ASSERT abs(r.total - v_t5_total) < 0.01,
    format('T5 total: esperado %s, got %s', v_t5_total, r.total);
  ASSERT abs(r.monto_facturado - v_t5_total) < 0.01,
    format('T5 monto_facturado: esperado %s, got %s', v_t5_total, r.monto_facturado);
  ASSERT r.recargo_iva_reducido = true,
    format('T5 recargo: esperado true, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'factura_a',
    format('T5 tipo_factura: esperado factura_a, got %s', r.tipo_factura);
  RAISE NOTICE '[T5] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- TEST 6 — Factura C 100%
  -- ============================================================
  v_items := jsonb_build_array(jsonb_build_object(
    'variante_id',          v_variante_id,
    'producto_nombre',      v_producto_nombre,
    'producto_sku',         v_producto_sku,
    'variante_sku',         v_variante_sku,
    'variante_color',       v_variante_color,
    'variante_talle',       v_variante_talle,
    'cantidad',             1,
    'precio_unitario_neto', v_precio,
    'subtotal_neto',        v_precio
  ));
  v_medios := jsonb_build_array(jsonb_build_object(
    'medio', 'efectivo', 'monto', v_precio, 'referencia', null
  ));

  v_result := cerrar_venta(
    p_usuario_id            => v_usuario_id,
    p_cliente_id            => v_cliente_id,
    p_canal                 => 'mostrador',
    p_items                 => v_items,
    p_medios_pago           => v_medios,
    p_descuento_total       => 0,
    p_tipo_factura          => 'factura_c'::tipo_factura,
    p_monto_facturado       => v_precio,
    p_nota_interna          => v_marker || ' — Test 6: Factura C',
    p_nombre_cliente_custom => NULL,
    p_recargo_iva_reducido  => false
  );
  v_venta_id := (v_result->>'venta_id')::uuid;

  SELECT subtotal_neto, descuento_total, total, monto_facturado,
         recargo_iva_reducido, tipo_factura
    INTO r FROM ventas WHERE id = v_venta_id;

  ASSERT r.subtotal_neto = v_precio,
    format('T6 subtotal_neto: esperado %s, got %s', v_precio, r.subtotal_neto);
  ASSERT r.descuento_total = 0,
    format('T6 descuento_total: esperado 0, got %s', r.descuento_total);
  ASSERT r.total = v_precio,
    format('T6 total: esperado %s, got %s', v_precio, r.total);
  ASSERT r.monto_facturado = v_precio,
    format('T6 monto_facturado: esperado %s, got %s', v_precio, r.monto_facturado);
  ASSERT r.recargo_iva_reducido = false,
    format('T6 recargo: esperado false, got %s', r.recargo_iva_reducido);
  ASSERT r.tipo_factura::text = 'factura_c',
    format('T6 tipo_factura: esperado factura_c, got %s', r.tipo_factura);
  RAISE NOTICE '[T6] OK — venta_id=% total=% facturado=%',
    v_venta_id, r.total, r.monto_facturado;

  -- ============================================================
  -- Validación final de stock
  -- ============================================================
  SELECT stock INTO v_stock_final FROM variantes WHERE id = v_variante_id;
  ASSERT v_stock_final = v_stock_inicial - 6,
    format('Stock final: esperado %s (inicial %s menos 6), got %s',
      v_stock_inicial - 6, v_stock_inicial, v_stock_final);

  RAISE NOTICE '----------------------------------------';
  RAISE NOTICE 'TODOS LOS TESTS PASARON';
  RAISE NOTICE '  Stock: % → % (delta -6, esperado)', v_stock_inicial, v_stock_final;
  RAISE NOTICE '  6 ventas persistidas con marker %', v_marker;
  RAISE NOTICE '----------------------------------------';
END $$;

-- ============================================================
-- Reporte resumen (correr aparte después del DO block)
-- ============================================================
SELECT
  numero,
  substring(nota_interna from '— (Test [0-9]+:[^—]+)') AS test,
  subtotal_neto,
  descuento_total,
  total                  AS total_cobrado,
  monto_facturado,
  recargo_iva_reducido   AS recargo,
  tipo_factura
FROM ventas
WHERE nota_interna LIKE 'TEST_IVA_2026_05_04%'
ORDER BY created_at;
