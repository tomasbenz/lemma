# Auditoría de seguridad multi-tenant — Relevamiento (Fase 1)

> **Estado:** RELEVAMIENTO. No se modificó nada (ni SQL, ni migraciones, ni TS).
> Este documento sólo reporta lo que existe hoy, clasificado por severidad y con
> evidencia. La Fase 2 (fixes) se arma después de revisar esto.
>
> **Ubicación:** la consigna pedía `docs/auditorias/…`. El repo ya tiene
> `docs/security/` (con `audit-log.md`), así que respeté esa convención y lo dejé
> acá. Avisado.
>
> **Fecha:** 2026-06-15 · **Auditor:** Claude (Opus 4.8) · **Alcance:** schema
> Postgres versionado en `supabase/migrations/` (33 migraciones, `00000000000000`
> → `00000000000032`) + código TS en `src/`.

## Nota metodológica (importante para reproducir)

No hay `DATABASE_URL` ni password de DB en `.env.local` (sólo
`NEXT_PUBLIC_SUPABASE_URL`, anon key y service role key), y PostgREST no expone
`pg_catalog`. Por lo tanto **el relevamiento se hizo por análisis estático sobre
el corpus de migraciones**, que según `CLAUDE.md` es la fuente canónica del
schema (Tomás las aplica a prod a mano, una por una). Cada finding cita
`archivo:línea`. Para confirmar el **estado vivo** de prod, al final de cada
sección dejo la query de `pg_catalog` exacta que conviene correr con el password
de DB (Supabase Dashboard → Project Settings → Database → Connection string).

Donde una función/policy/vista se redefine en varias migraciones, **se auditó la
última definición** (la canónica). Las redefiniciones relevantes:
`cerrar_venta`→031, `finalizar_pedido`→031, `editar_venta`/`anular_venta`→032,
`guardar_pedido`→006, `eliminar_producto`→029, `productos_bulk_*`→010/014/023,
`importar_productos_bulk`→016, `productos_con_stock_total`→029, todas las
policies core→003.

---

## Resumen ejecutivo

| Severidad | Cantidad | Findings |
|-----------|----------|----------|
| **CRÍTICO** | **2** | F-01 vista `ventas_con_resumen` sin `security_invoker` (fuga cross-tenant de ventas/financiero, explotable por el path normal de la app) · F-02 vista `v_acciones_superadmin` sin `security_invoker` (fuga del audit log de superadmin: IPs, emails, motivos, cross-tenant) |
| **ALTO** | **5** | F-03 vista `v_usuario_empresa_id` sin `security_invoker` · F-04 `FORCE ROW LEVEL SECURITY` ausente en todas las tablas multi-tenant · F-05 `operaciones_masivas` sin trigger append-only · F-06 `persistir_cae_y_marcar_emitida` confía en `p_empresa_id` del cliente (sin validar membresía del caller) · F-07 `registrar_login` inserta en `audit_log` sin `empresa_id` |
| **MEDIO** | **3** | F-08 3 writes confinan por PK sin repetir `empresa_id` en el UPDATE (defense-in-depth) · F-09 `audit_log.entidad_id` es `text` y guarda UUIDs · F-10 funciones SECURITY INVOKER sin `SET search_path` pin |
| **INFO** | **4** | F-11 patrón de bypass intencional de superadmin (`empresa_id IS NULL`) · F-12 `handle_new_user` inserta `usuarios` sin empresa (por diseño) · F-13 3 tablas RLS+FORCE sin policies (deny-all intencional) · F-14 `getEmpresaFeatures` usa admin client en read path |

**Lectura de una línea:** el modelo de aislamiento por RLS + RPCs SECURITY
DEFINER está **muy bien construido** — las 34 policies filtran por `empresa_id`,
y las ~30 RPCs SECURITY DEFINER validan `auth.uid() = p_usuario_id` y el
`empresa_id` del recurso antes de mutar. El agujero real está en **las vistas**:
3 de 4 corren como owner y **saltean RLS**, y una de ellas (`ventas_con_resumen`)
la consume el listado de ventas del admin **sin ningún filtro de `empresa_id`**,
por lo que hoy filtra ventas entre tenants.

---

## Sección 1 — Estado RLS por tabla

Todas las tablas tienen RLS habilitada (`ENABLE ROW LEVEL SECURITY`). El detalle
fino es el `FORCE`: **sólo 3 tablas lo tienen** (`afip_ta_cache`,
`afip_request_log`, `mp_webhook_events` — init L606-608). Ninguna tabla
multi-tenant lo tiene.

| Tabla | `empresa_id`? | RLS enabled | RLS **forced** | Nota |
|-------|:---:|:---:|:---:|------|
| empresas | (es la raíz) | ✓ | ✗ | tenant root |
| usuarios | ✓ (nullable) | ✓ | ✗ | F-04 |
| configuracion | ✓ (unique) | ✓ | ✗ | F-04 |
| audit_log | ✓ (nullable) | ✓ | ✗ | F-04 |
| catalogo_categorias | ✓ | ✓ | ✗ | F-04 |
| categoria_atributos | ✓ | ✓ | ✗ | F-04 |
| clientes | ✓ | ✓ | ✗ | F-04 |
| productos | ✓ | ✓ | ✗ | F-04 |
| variantes | ✓ | ✓ | ✗ | F-04 |
| ventas | ✓ | ✓ | ✗ | F-04 + alimenta vista F-01 |
| items_venta | ✓ | ✓ | ✗ | F-04 + alimenta vista F-01 |
| items_venta_componentes | ✓ | ✓ | ✗ | F-04 |
| medios_pago_venta | ✓ | ✓ | ✗ | F-04 |
| pagos | ✓ | ✓ | ✗ | F-04 |
| facturas | ✓ | ✓ | ✗ | F-04 |
| facturas_afip | ✓ | ✓ | ✗ | F-04 |
| combo_componentes | ✓ | ✓ | ✗ | F-04 |
| sucursales | ✓ | ✓ | ✗ | F-04 |
| cajas | (vía sucursal) | ✓ | ✗ | scope por `sucursal.empresa_id` |
| turnos_caja | ✓ | ✓ | ✗ | F-04 |
| marcas | ✓ | ✓ | ✗ | F-04 |
| operaciones_masivas | ✓ | ✓ | ✗ | F-04 + F-05 |
| operaciones_masivas_precio_detalle | ✓ | ✓ | ✗ | F-04 |
| afip_ta_cache | ✓ | ✓ | **✓** | deny-all (F-13) |
| afip_request_log | ✓ | ✓ | **✓** | deny-all (F-13) |
| mp_webhook_events | ✓ | ✓ | **✓** | deny-all (F-13) |

No hay ninguna tabla multi-tenant con `rls_enabled=false`. Eso es lo bueno. El
problema es `FORCE` (F-04).

### [ALTO] F-04 — `FORCE ROW LEVEL SECURITY` ausente en todas las tablas multi-tenant
**Ubicación**: todas las tablas con `empresa_id` (init L586-603; sólo L606-608
aplican FORCE, a las 3 AFIP/webhook).
**Descripción**: RLS está `ENABLE` pero no `FORCE` en productos, variantes,
ventas, items_venta, clientes, etc. Sin `FORCE`, **el dueño de la tabla
(`postgres`/`supabase_admin`) saltea RLS sobre ella**. Esto normalmente no afecta
al rol `authenticated` (que no es owner y sí ve RLS), pero **sí afecta a
cualquier vista no-`security_invoker` o función SECURITY DEFINER cuyo owner sea
`postgres`**, que es justamente el vector de F-01/F-02/F-03.
**Evidencia**:
```sql
-- init L586-603: 18 × ENABLE, 0 × FORCE para tablas multi-tenant
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;   -- sin FORCE
-- init L606-608: las únicas con FORCE
ALTER TABLE afip_ta_cache FORCE ROW LEVEL SECURITY;
```
**Hipótesis de explotación**: por sí solo no es directamente explotable por un
usuario de API que consulta la tabla (RLS le sigue aplicando). Pero es la
**condición habilitante** de la fuga F-01: la vista `ventas_con_resumen` corre
como `postgres`, que al ser owner de `ventas`/`items_venta` sin `FORCE` ve todas
las filas de todos los tenants. Con `FORCE` en esas tablas, aun una vista mal
configurada quedaría sujeta a RLS.
**Recomendación**: `ALTER TABLE … FORCE ROW LEVEL SECURITY` en todas las tablas
multi-tenant (revisar que ninguna RPC SECURITY DEFINER dependa de saltear su
propia RLS — todas filtran por `empresa_id` a mano, así que no debería romper).

**Query de verificación viva:**
```sql
SELECT n.nspname, c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;
```

### [INFO] F-13 — 3 tablas con RLS+FORCE y cero policies (deny-all intencional)
**Ubicación**: `afip_ta_cache`, `afip_request_log`, `mp_webhook_events`.
**Descripción**: tienen RLS+FORCE pero **ninguna policy** en ninguna migración →
denegación total desde anon/authenticated; sólo accesibles vía service role
(webhooks AFIP/MP). Es la postura intencional para tablas de secretos/webhooks.
Tienen `empresa_id` pero se apoyan en lockout total en vez de policy. Sin riesgo.

---

## Sección 2 — Policies

**34 policies finales, todas PERMISSIVE, todas sobre el rol `public` (default).**
La migración 003 dropea y recrea todas las policies del init (L55-78 drop,
L329-429 recreate); ésas son las canónicas. El resto de las tablas definen su
policy una sola vez. **Resultado: ninguna policy con `USING (true)`/`WITH CHECK
(true)`, ninguna policy de write sin `empresa_id` en el `WITH CHECK`, ninguna
huérfana.** El layer de policies está limpio.

La garantía completa descansa en el helper `get_empresa_id()`
(`00000000000003_rpcs_helpers_y_triggers.sql:161-168`), que resuelve el tenant
del caller desde `auth.uid()`:
```sql
CREATE OR REPLACE FUNCTION public.get_empresa_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT empresa_id FROM public.usuarios WHERE id = auth.uid() $function$;
```

### Apéndice 2.A — Tabla completa de policies (todas verdictan OK / GLOBAL-OK)

| Tabla | Policy | cmd | USING / WITH CHECK (resumen) | file:line | Verdict |
|-------|--------|-----|------------------------------|-----------|---------|
| empresas | empresas_select | SELECT | `es_superadmin() OR id = get_empresa_id()` | mig003:329 | GLOBAL-OK (tenant root) |
| usuarios | usuarios_select | SELECT | `es_superadmin() OR (empresa_id = get_empresa_id() AND rol<>'superadmin') OR id = auth.uid()` | mig003:332 | OK |
| configuracion | configuracion_select | SELECT | `es_superadmin() OR empresa_id = get_empresa_id()` | mig003:339 | OK |
| audit_log | audit_log_select | SELECT | `es_superadmin() OR empresa_id = get_empresa_id()` | mig003:342 | OK |
| catalogo_categorias | _select / _write | SELECT / ALL | scope `empresa_id = get_empresa_id()` (write con WITH CHECK) | mig003:345/348 | OK |
| categoria_atributos | _select / _write | SELECT / ALL | idem | mig003:352/355 | OK |
| clientes | _select / _write | SELECT / ALL | idem | mig003:359/362 | OK |
| productos | _select / _write | SELECT / ALL | idem | mig003:366/369 | OK |
| variantes | _select / _write | SELECT / ALL | idem | mig003:373/376 | OK |
| ventas | ventas_select | SELECT | `es_superadmin() OR empresa_id = get_empresa_id()` (write sólo vía RPC) | mig003:380 | OK |
| items_venta | items_venta_select | SELECT | idem | mig003:383 | OK |
| medios_pago_venta | _select | SELECT | idem | mig003:386 | OK |
| pagos | pagos_select | SELECT | idem | mig003:389 | OK |
| facturas | facturas_select | SELECT | idem | mig003:392 | OK |
| facturas_afip | _select | SELECT | idem | mig003:395 | OK |
| sucursales | _select / _write | SELECT / ALL | `empresa_id = get_empresa_id()` | mig003:398/401 | OK |
| cajas | _select / _write | SELECT / ALL | `EXISTS(sucursales s WHERE s.id=cajas.sucursal_id AND s.empresa_id=get_empresa_id())` | mig003:405/415 | OK (scope vía padre) |
| turnos_caja | _select / _write | SELECT / ALL | `empresa_id = get_empresa_id()` | mig006:63/66 | OK |
| operaciones_masivas | _select | SELECT | `es_superadmin() OR empresa_id = get_empresa_id()` (sin write policy → RPC-only) | mig010:50 | OK |
| marcas | _select / _write | SELECT / ALL | `empresa_id = get_empresa_id()` | mig014:63/67 | OK |
| operaciones_masivas_precio_detalle | _select | SELECT | `es_superadmin() OR empresa_id = get_empresa_id()` (sin write policy) | mig023:49 | OK |
| combo_componentes | _select / _write | SELECT / ALL | `empresa_id = get_empresa_id()` | mig028:93/97 | OK |
| items_venta_componentes | _select / _write | SELECT / ALL | `empresa_id = get_empresa_id()` | mig031:47/51 | OK |

**Observaciones**:
- `ventas`, `items_venta`, `medios_pago_venta`, `pagos`, `facturas`,
  `facturas_afip`, `operaciones_masivas`, `operaciones_masivas_precio_detalle`
  tienen **sólo policy SELECT** → todos los writes están denegados desde el
  cliente y pasan por RPCs SECURITY DEFINER (sección 3). Correcto.
- `es_admin()`/`es_admin_estricto()`/`get_rol_usuario()`/`rol_actual()` son
  predicados de rol sin scope de empresa, pero **no se usan en ninguna policy**
  (sólo dentro de cuerpos de RPC), así que no debilitan el layer de policies.

**Query de verificación viva:**
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
```

---

## Sección 3 — Funciones SECURITY DEFINER

Se auditaron las ~30 funciones SECURITY DEFINER (última versión de cada una) con
los 4 chequeos. **Resumen: todas las RPCs de write transaccional están bien**:
pinnean `search_path`, re-derivan `empresa_id` desde `auth.uid()`/`usuarios`
(nunca confían en un empresa del cliente), validan `auth.uid() = p_usuario_id`
cuando aceptan ese arg, validan el `empresa_id` del recurso antes de mutar, y
setean `empresa_id` en todos los INSERT. Dos excepciones reales (F-06, F-07) y
una nota de hardening (F-08) abajo.

### Tabla de chequeos (write RPCs principales)

| Función (última ver.) | file:line | (A) search_path | (B) `auth.uid()=p_usuario_id` | (C) valida `empresa_id` del recurso | (D) INSERT con `empresa_id` |
|---|---|:---:|:---:|:---:|:---:|
| cerrar_venta | 031:58 | ✓ | ✓ (031:106) | ✓ cliente/variante/combo + UPDATE stock scoped | ✓ |
| finalizar_pedido | 031:377 | ✓ | ✓ (031:418) | ✓ pedido (031:454) + variantes | ✓ |
| editar_venta | 032:30 | ✓ | ✓ (032:76) | ✓ venta (032:100) + variante (032:122) | ✓ |
| anular_venta | 032:251 | ✓ | n/a (usa `auth.uid()`+`es_admin()`) | ✓ venta (032:296) | ✓ |
| guardar_pedido | 006:751 | ✓ | ✓ (006:780) | ✓ cliente/variante | ✓ |
| ajustar_stock | 003:1003 | ✓ | ✓ (003:1027) | ✓ variante (003:1042) + UPDATE scoped | ✓ |
| anular_pedido | 003:1200 | ✓ | n/a (`auth.uid()`+`es_admin()`) | ✓ pedido (003:1249) | ✓ |
| editar_pedido | 003:1460 | ✓ | ✓ (003:1490) | ✓ pedido (003:1516) + variante | ✓ |
| importar_productos_bulk | 016:289 | ✓ | ✓ (016:322) + `es_admin()` | ✓ (sku scoped a empresa) | ✓ |
| productos_bulk_update | 014:222 | ✓ | ✓ (014:251) + `es_admin()` | ✓ (ids + marca + categoría scoped, doble WHERE) | ✓ |
| productos_bulk_import | 014:419 | ✓ | ✓ + `es_admin()` | ✓ (doble WHERE) | ✓ |
| productos_bulk_stock | 010:226 | ✓ | ✓ (010:260) + `es_admin()` | ✓ (doble WHERE 010:361) | ✓ |
| productos_bulk_stock_individual | 010:533 | ✓ | ✓ + `es_admin()` | ✓ (doble WHERE) | ✓ |
| productos_bulk_precio_individual | 023:80 | ✓ | ✓ + `es_admin()` | ✓ (doble WHERE 023:181) | ✓ |
| aumentar_precios_por_categoria | 021:54 | ✓ | ✓ (021:79) + `es_admin()` | ✓ marca/categoría + UPDATE scoped | ✓ |
| revertir_operacion_precios | 023:239 | ✓ | ✓ (023:264) + `es_admin()` | ✓ operación (023:288) + UPDATE scoped (023:347) | ✓ |
| eliminar_producto | 029:317 | ✓ | ✓ (029:341) + `es_admin()` | ✓ pre-check + DELETE/UPDATE scoped (029:418/423) | ✓ |
| cambiar_precio_producto_caja | 027:30 | ✓ | ✓ (027:54) | ✓ producto (027:90) + UPDATE scoped (027:96) | ✓ |
| abrir_turno | 006:88 | ✓ | n/a (`auth.uid()`) | ✓ caja vía sucursal (006:142) | ✓ |
| cerrar_turno | 006:278 | ✓ | n/a | ✓ pre-check (006:310) — UPDATE por PK (ver F-08) | ✓ |
| forzar_cierre_turno | 006:372 | ✓ | n/a (`es_admin()`) | ✓ pre-check (006:403) — UPDATE por PK (ver F-08) | ✓ |
| sa_* (×5) | 003:1910-2258 | ✓ | n/a (`es_superadmin()`) | n/a (tooling cross-tenant intencional) | ✓ |

**Funciones SECURITY INVOKER (no DEFINER) llamadas desde cliente — dependen 100%
de RLS** (cubiertas por sección 1): `reporte_ventas_agregado` (003:1814),
`ventas_totales_filtrados` (003:1860), `reporte_dashboard` (017:26),
`buscar_productos_ids`/`buscar_clientes_ids` (025, igual filtran por
`empresa_id = (SELECT … WHERE id=auth.uid())` a mano). Sin riesgo mientras RLS
siga activa.

### [ALTO] F-06 — `persistir_cae_y_marcar_emitida` confía en `p_empresa_id` del cliente
**Ubicación**: función `persistir_cae_y_marcar_emitida`
(`00000000000003_rpcs_helpers_y_triggers.sql:1752`), GRANTeada a `authenticated`
(mig003:2327).
**Descripción**: a diferencia de todas las demás RPCs, **no deriva el
`empresa_id` del caller desde `usuarios`/`auth.uid()`** — acepta `p_empresa_id`
como parámetro y lo usa de filtro. El único gate es `auth.uid() IS NULL`; no hay
`es_admin()` ni chequeo de que el caller pertenezca a `p_empresa_id`.
**Evidencia**:
```sql
-- 003:1753-1755 — empresa viene del cliente
p_factura_id uuid, p_venta_id uuid, p_empresa_id uuid, ...
-- 003:1783-1784 / 1797-1798 — se confía en p_empresa_id como scope
WHERE id = p_factura_id AND empresa_id = p_empresa_id;   -- no valida membresía del caller
WHERE id = p_venta_id   AND empresa_id = p_empresa_id;
```
**Hipótesis de explotación**: un usuario autenticado del tenant A que conozca
(o adivine) un `empresa_id` + `factura_id` + `venta_id` válidos del tenant B
podría marcar la factura de B como emitida y persistirle un CAE. La consistencia
interna (factura y venta deben pertenecer al mismo `p_empresa_id`) limita el
daño, y los IDs son UUIDs no enumerables, pero **el control de tenant se delega
en que el server-route pase el empresa correcto**, no en la función. Es el
eslabón más débil de la familia SECURITY DEFINER.
**Recomendación**: derivar `empresa_id` internamente desde
`SELECT empresa_id FROM usuarios WHERE id = auth.uid()` y/o validar
`p_empresa_id = get_empresa_id()` al entrar; opcionalmente sumar gate de rol.

### [ALTO] F-07 — `registrar_login` inserta en `audit_log` sin `empresa_id`
**Ubicación**: función `registrar_login`
(`00000000000003_rpcs_helpers_y_triggers.sql:2271`), INSERT en L2290-2293.
**Descripción**: el INSERT a `audit_log` no setea `empresa_id` (lista de columnas
`(usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, ip,
user_agent)`), mientras todas las demás funciones sí lo setean (p.ej.
`ajustar_stock` 003:1073, `anular_venta` 032:359).
**Evidencia**:
```sql
-- 003:2290-2293
INSERT INTO public.audit_log
  (usuario_id, usuario_email_snapshot, entidad, entidad_id, accion, ip, user_agent)
VALUES (auth.uid(), …);   -- empresa_id queda NULL
```
**Hipótesis de explotación**: no es un cross-tenant write (es un INSERT del
propio usuario en la tabla de auditoría append-only). Impacto práctico bajo: las
filas de login quedan con `empresa_id = NULL`, por lo que **son invisibles a la
policy `audit_log_select`** (`empresa_id = get_empresa_id()`) y el admin del
tenant nunca ve los logins de su gente en el audit log. Es inconsistencia de
hardening / pérdida de trazabilidad, no una brecha de aislamiento.
**Recomendación**: setear `empresa_id` (derivado de `usuarios WHERE id=auth.uid()`)
en el INSERT.

### [MEDIO] F-08 — 3 writes confinan por PK sin repetir `empresa_id` en el UPDATE
**Ubicación**: `cerrar_turno` (006:334-340), `forzar_cierre_turno` (006:418-423),
`importar_productos_bulk` rama UPDATE (016, equivalente a 014:843-849).
**Descripción**: estas tres mutaciones son UPDATE de una sola fila por PK
(`WHERE id = …`) **sin repetir `AND empresa_id = v_empresa_id`**, apoyándose en
un pre-check tenant-scopeado inmediato (con `FOR UPDATE` en los turnos). Es
seguro en la práctica, pero rompe el patrón de doble-WHERE que `CLAUDE.md`
prescribe y que sí siguen el resto de los writers (`eliminar_producto`,
`cambiar_precio_producto_caja`, `revertir_operacion_precios`, etc.).
**Evidencia**:
```sql
-- 006:310-316 pre-check OK; pero el UPDATE 006:334-340:
UPDATE public.turnos_caja SET … WHERE id = p_turno_id;   -- sin AND empresa_id
```
**Hipótesis de explotación**: no explotable hoy (el pre-check con lock confina la
fila). Riesgo sólo si una refactorización futura mueve/elimina el pre-check.
**Recomendación**: agregar `AND empresa_id = v_empresa_id` al UPDATE (defense in
depth, costo cero).

**Query de verificación viva:**
```sql
SELECT p.proname, p.prosecdef, p.proconfig AS settings,
       pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS body
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true ORDER BY p.proname;
```

### [INFO] F-11 — Bypass intencional de superadmin (`empresa_id IS NULL`)
**Ubicación**: `editar_venta` (032:100), `anular_venta` (032:296),
`editar_pedido` (003:1516), `anular_pedido` (003:1249), `forzar_cierre_turno`
(006:407).
**Descripción**: el patrón `IF v_usuario_empresa_id IS NOT NULL AND
<recurso>.empresa_id <> v_usuario_empresa_id THEN RAISE …` deja pasar al caller
cuyo `empresa_id` es NULL (superadmin impersonando). Es diseño documentado, no
un check faltante; lo dejo anotado para que no se confunda con un bug.

### [INFO] F-12 — `handle_new_user` inserta `usuarios` sin `empresa_id`
**Ubicación**: trigger `handle_new_user` (003:230, INSERT L259-267).
**Descripción**: un usuario recién registrado no tiene empresa todavía (se la
asigna un admin/superadmin después), así que `empresa_id` queda NULL a propósito.
Es el estado nulo que el resto de las RPCs justamente bloquean (`IF v_empresa_id
IS NULL THEN RAISE …`). No es vulnerabilidad.

---

## Sección 4 — Vistas y `security_invoker`

4 vistas. **Sólo `productos_con_stock_total` está protegida.** Las otras 3 nunca
reciben `security_invoker=true` en ninguna migración → corren como owner
(`postgres`) y **saltean RLS** sobre las tablas multi-tenant que leen.

| Vista | Lee tablas multi-tenant | `security_invoker=true`? | Verdict |
|-------|---|:---:|---|
| productos_con_stock_total | productos, variantes, marcas, catalogo_categorias | **✓** (mig018:17, re-aplicado mig029:296 con guard) | OK |
| ventas_con_resumen | ventas, items_venta | ✗ (nunca) | **F-01 CRÍTICO** |
| v_acciones_superadmin | audit_log, usuarios | ✗ (nunca) | **F-02 CRÍTICO** |
| v_usuario_empresa_id | usuarios | ✗ (nunca) | **F-03 ALTO** |

### [CRÍTICO] F-01 — `ventas_con_resumen` saltea RLS y se consume sin filtro de empresa
**Ubicación**: vista `ventas_con_resumen`
(`00000000000004_fix_schema_completeness.sql:60`); consumida en
`src/lib/queries/ventas.ts:99` (`listarVentas`).
**Descripción**: la vista lee `ventas` + agrega `items_venta` y **no tiene
`security_invoker`**, así que corre con privilegios del owner y ve todas las
filas de todos los tenants. Peor: el path real de la app — el listado de ventas
del admin (`/admin/ventas`) — la consulta con el cliente RLS **pero sin ningún
`.eq('empresa_id', …)`**, confiando enteramente en RLS (que la vista saltea).
**Evidencia**:
```sql
-- mig004:58-92 — sin WITH (security_invoker=true), nunca se le aplica ALTER
DROP VIEW IF EXISTS public.ventas_con_resumen;
CREATE VIEW public.ventas_con_resumen AS SELECT v.* … FROM public.ventas v;
```
```ts
// src/lib/queries/ventas.ts:98-132 — NO hay filtro empresa_id; sólo filtros de UI
let query = supabase.from('ventas_con_resumen').select(`…`, { count: 'exact' })
if (desde) query = query.gte('created_at', desde)   // … nada de empresa_id
```
(`grep security_invoker` sobre todas las migraciones para `ventas_con_resumen` →
**NONE FOUND**.)
**Hipótesis de explotación**: un admin/vendedora del tenant A entra a
`/admin/ventas` y **ve las ventas de TODOS los tenants** (número, totales,
`nota_interna`, cliente custom, estado de facturación AFIP) — fuga directa de
datos financieros entre clientes, por el flujo normal de la UI, sin tooling.
Además, cualquier usuario autenticado puede pegarle directo a
`GET /rest/v1/ventas_con_resumen` vía PostgREST y traerse todo. Con dos tenants
reales (Samu + Demo) ya hoy se cruzan. Es la condición F-04 (sin `FORCE`) +
vista sin `security_invoker` actuando juntas.
**Recomendación**: `ALTER VIEW public.ventas_con_resumen SET (security_invoker =
true);` (mismo fix que mig018 para la otra vista) y, defensivo, agregar
`.eq('empresa_id', user.empresa_id)` en `listarVentas`.

### [CRÍTICO] F-02 — `v_acciones_superadmin` saltea RLS (fuga del audit de superadmin)
**Ubicación**: vista `v_acciones_superadmin` (`00000000000000_init_lemma.sql:559`).
**Descripción**: lee `audit_log JOIN usuarios` filtrando
`es_accion_superadmin = true`, sin `security_invoker`. Expone, cross-tenant: `ip`,
`motivo_superadmin`, `detalle jsonb`, `entidad_id`, y el `email` del superadmin
que actuó.
**Evidencia**:
```sql
-- init:559-573 — sin security_invoker (nunca se le aplica)
CREATE VIEW v_acciones_superadmin AS
SELECT al.id, …, al.ip, al.motivo_superadmin, u.email AS superadmin_email
FROM audit_log al LEFT JOIN usuarios u ON u.id = al.usuario_id
WHERE al.es_accion_superadmin = true;
```
**Hipótesis de explotación**: la app no usa esta vista (no aparece en `src/`),
pero al estar en `public` y (por default de Supabase) con SELECT para
`authenticated`, **cualquier usuario logueado puede consultarla directo vía
PostgREST** y leer el log global de acciones de superadmin de todos los tenants
(IPs, emails, motivos). Fuga cross-tenant de datos sensibles de auditoría.
**Recomendación**: `ALTER VIEW … SET (security_invoker = true)` y/o `REVOKE
SELECT … FROM authenticated, anon` (la vista es de uso superadmin-only).

### [ALTO] F-03 — `v_usuario_empresa_id` saltea RLS (mapeo id↔empresa cross-tenant)
**Ubicación**: vista `v_usuario_empresa_id` (`00000000000000_init_lemma.sql:555`).
**Descripción**: `SELECT id AS usuario_id, empresa_id FROM usuarios`, sin
`security_invoker`. Expone el mapeo completo usuario→empresa de todos los tenants.
**Evidencia**:
```sql
-- init:555-557
CREATE VIEW v_usuario_empresa_id AS SELECT id AS usuario_id, empresa_id FROM usuarios;
```
**Hipótesis de explotación**: cualquier usuario autenticado puede enumerar vía
PostgREST qué UUIDs de usuario pertenecen a qué empresa (incluida la propia
estructura de otros tenants). Menos sensible que F-01/F-02 (no hay PII ni
financiero, sólo la asociación id↔empresa), pero es fuga cross-tenant igual y
material reconocimiento para otros ataques. La app no la consulta con `.from()`
(sólo aparece como `referencedRelation` de FKs en `database.ts`).
**Recomendación**: `ALTER VIEW … SET (security_invoker = true)` o REVOKE de
authenticated/anon. Evaluar si la vista sigue siendo necesaria.

**Query de verificación viva:**
```sql
SELECT n.nspname, c.relname, c.reloptions, pg_get_viewdef(c.oid, true) AS def
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v';
-- confirmar que reloptions contiene 'security_invoker=true' (literal) en cada vista que lee tablas multi-tenant
```

---

## Sección 5 — Tablas de auditoría

3 tablas de auditoría: `audit_log`, `operaciones_masivas`,
`operaciones_masivas_precio_detalle`. Dos son append-only por trigger; **a
`operaciones_masivas` le falta el trigger** (F-05).

| Tabla | Append-only (trigger UPDATE+DELETE)? | `empresa_id` en INSERTs | Columna entidad |
|-------|:---:|:---:|---|
| audit_log | ✓ `prevent_audit_changes` (mig003:209) + triggers (mig003:295-303) | ✓ (salvo F-07) | `entidad_id text` → F-09 |
| operaciones_masivas | **✗ ninguno** → F-05 | ✓ | `ids_afectados jsonb` (ok) |
| operaciones_masivas_precio_detalle | ✓ `prevent_precio_detalle_changes` (mig023:58) + triggers (mig023:67-75) | ✓ | `producto_id uuid` (ok) |

### [ALTO] F-05 — `operaciones_masivas` sin trigger append-only
**Ubicación**: tabla `operaciones_masivas`
(`00000000000010_operaciones_masivas.sql:27`).
**Descripción**: es una tabla de auditoría de operaciones masivas (aumentos,
bulk stock/precio, etc.), pero **no tiene trigger que bloquee UPDATE/DELETE**,
a diferencia de sus dos tablas hermanas. RLS tiene sólo policy SELECT (no hay
write desde cliente), pero una RPC SECURITY DEFINER, el owner o el service role
pueden modificar/borrar estos registros de auditoría sin nada que lo impida.
**Evidencia**: `grep` de triggers `ON public.operaciones_masivas` en todas las
migraciones → sólo índices (L43,45) y la policy SELECT (L49-51). No existe
`prevent_*` para esta tabla.
**Hipótesis de explotación**: no es fuga entre tenants; es integridad de la
auditoría. Quien tenga el path SECURITY DEFINER o service role (p.ej. una RPC
futura, o un bug) podría reescribir/eliminar el historial de operaciones masivas
—el mismo historial del que depende `revertir_operacion_precios`— sin rastro.
**Recomendación**: agregar `prevent_*_changes()` + triggers
`BEFORE UPDATE/DELETE` igual que las otras dos tablas de auditoría.

### [MEDIO] F-09 — `audit_log.entidad_id` es `text` pero guarda UUIDs
**Ubicación**: `audit_log.entidad_id text` (`00000000000000_init_lemma.sql:191`).
**Descripción**: la columna guarda IDs de entidad que en la práctica son UUIDs
(las sa_* insertan `p_venta_id`, `p_variante_id`, `p_usuario_id`). Tiparla `text`
no fuerza formato ni permite FK/validación.
**Hipótesis de explotación**: sin riesgo de seguridad directo; es higiene de
datos / posible inconsistencia de formato y queries de auditoría menos robustas.
**Recomendación**: evaluar migrar a `uuid` (con cast/validación de datos
existentes) o documentar explícitamente que es polimórfica.

### [MEDIO] F-10 — Funciones SECURITY INVOKER sin `SET search_path` pin
**Ubicación**: `reporte_ventas_agregado` (003:1814), `ventas_totales_filtrados`
(003:1860), `validar_puntos_venta` (003:218), `_redondear_precio` (021:37),
`prevent_precio_detalle_changes` (023:58).
**Descripción**: no pinnean `search_path`. Todas son SECURITY INVOKER (corren con
derechos del caller + RLS), por lo que el riesgo de search-path hijacking es
mucho menor que en una DEFINER, y varias no tocan objetos de schema
(`_redondear_precio` es matemática pura). **Todas las SECURITY DEFINER sí tienen
el pin** — esto es sólo consistencia de hardening.
**Recomendación**: agregar `SET search_path TO 'public'` a las que tocan tablas
(`reporte_ventas_agregado`, `ventas_totales_filtrados`, `validar_puntos_venta`).

**Query de verificación viva:**
```sql
SELECT c.relname, array_agg(t.tgname) FILTER (WHERE NOT t.tgisinternal) AS triggers
FROM pg_class c LEFT JOIN pg_trigger t ON t.tgrelid = c.oid
WHERE c.relname IN ('audit_log','operaciones_masivas','operaciones_masivas_precio_detalle')
GROUP BY c.relname;
```

---

## Sección 6 — Uso del admin client (service-role) en TS

Factory única: `createAdminClient()` en `src/lib/supabase/admin.ts:18`, con
`SUPABASE_SERVICE_ROLE_KEY` (**saltea RLS**), `persistSession:false`,
`import 'server-only'`. Las otras dos factories (`server.ts:27` SSR/anon,
`client.ts` browser/anon) **respetan RLS** y son el path correcto.

**19 call-sites del admin client, en 9 archivos. Clasificación: 19
INFO-EXPECTED, 0 ALTO.** Ningún call-site usa un `empresa_id`/`id` tomado del
body como scope de tenant: todos derivan `empresa_id` de la sesión
(`getCurrentUser()`/`authzAdmin()`) o son contexto superadmin rol-gateado.

| Grupo | Archivos / líneas | Por qué admin | Clase |
|-------|---|---|---|
| AFIP (infra fiscal, sin sesión de usuario) | `afip/empresa.ts:36`, `afip/request-log.ts:180`, `afip/recovery.ts:85,128`, `afip/wsaa/token-cache.ts:42,92` | firma SOAP / cache TA / log AFIP / recovery de facturación; los UPDATE a `ventas` re-filtran `.eq('id').eq('empresa_id')` | INFO-EXPECTED |
| Webhook MP (sin sesión) | `api/webhooks/mp/[secret_segment]/route.ts:206` | procesa notificación de pago tras validar HMAC | INFO-EXPECTED |
| Superadmin tooling (rol-gateado) | `superadmin/page.tsx:41`, `superadmin/_actions/empresa-impersonacion.ts:32,76`, `…/desactivar-empresa.ts:35,105`, `…/crear-empresa.ts:79` | cross-tenant por diseño; guard `rol==='superadmin'` | INFO-EXPECTED |
| Auth/signout | `api/auth/signout` (`sign-out-action.ts:30`) | resetea `empresa_id=null` del propio superadmin al desloguear | INFO-EXPECTED |
| User mgmt (Auth Admin API) | `admin/usuarios/_actions/usuarios-actions.ts:89,192,259,315` | requiere service role para `auth.admin.*`; pre-check `target.empresa_id===authz.empresaId` | INFO-EXPECTED |
| Feature flags (read) | `lib/features.ts:57` | lee `empresas.features`; ver F-14 | INFO-EXPECTED (borderline) |

### [INFO] F-14 — `getEmpresaFeatures` usa admin client en un read path
**Ubicación**: `src/lib/features.ts:57`.
**Descripción**: lee `empresas.features` con el admin client en una request
autenticada, filtrando `.eq('id', empresaId)`. **Seguro hoy** porque todos los
callers pasan `user.empresa_id` derivado del server (verificado en
`caja/page.tsx:38-39` y `caja/_actions/cerrar-venta.ts:150-151`), nunca un id del
body. Es el único read path donde el service role no es estrictamente necesario.
**Recomendación (hardening, no urgente)**: pasarlo al cliente RLS-scopeado
(`createClient()`), ya que el usuario tiene RLS para su propia fila de
`empresas`. Confirmar antes que no se llame desde un contexto sin cookies.

**Comando de verificación:**
```bash
grep -rnE 'createAdminClient|supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY' src/
```

---

## Sección 7 — Familia superadmin (`sa_*`)

5 funciones, todas en `00000000000003_rpcs_helpers_y_triggers.sql`:
`sa_exportar_datos` (1910), `sa_forzar_estado_venta` (2038), `sa_health_check`
(2089), `sa_reparar_stock` (2143), `sa_simular_vista_usuario` (2197).

**Todas correctamente hardeneadas — sin findings.** Cada una:
- es SECURITY DEFINER + `SET search_path TO 'public'`;
- gate `auth.uid() IS NULL` → luego `IF NOT public.es_superadmin() THEN RAISE
  EXCEPTION 'Acceso denegado: requiere rol superadmin'` (p.ej. 2054-2056);
- exige `p_motivo` ≥ 10 chars (salvo health_check) y escribe a `audit_log` con
  `es_accion_superadmin=true`;
- tiene `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (2261-2265), **nunca
  re-GRANTeada** en ninguna migración posterior.

```sql
-- 003:2261-2265
REVOKE EXECUTE ON FUNCTION public.sa_exportar_datos(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_forzar_estado_venta(uuid, venta_estado, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_health_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_reparar_stock(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_simular_vista_usuario(uuid, text) FROM PUBLIC, anon, authenticated;
```

El alcance cross-tenant (exportar datos de cualquier/todas las empresas, forzar
estado de cualquier venta, reparar stock, simular vista de usuario) es
intencional para tooling de superadmin y está doblemente protegido (permisos
Postgres + `es_superadmin()` interno). No existen funciones `super_*` ni
`admin_*` en las migraciones. Sección **OK**.

---

## Hallazgos adicionales

Ninguno fuera de scope más allá de lo ya reportado. No se encontraron: `SET ROLE`
en funciones, columnas `empresa_id` duplicadas/contradictorias en tablas hijas
(todas referencian `empresas(id)` consistentemente con `ON DELETE CASCADE`), ni
triggers sospechosos. El patrón de seguridad de `CLAUDE.md` (guard temprano +
pre-check + doble `.eq('empresa_id')`) se cumple sistemáticamente tanto en SQL
como en TS — salvo las excepciones puntuales listadas (F-06, F-07, F-08).

---

## Checklist Fase 2 (ordenado por severidad)

- [ ] **CRÍTICO · F-01** — `ALTER VIEW public.ventas_con_resumen SET (security_invoker = true);` + agregar `.eq('empresa_id', user.empresa_id)` en `listarVentas` (`src/lib/queries/ventas.ts`). *(Migración nueva + edit TS.)*
- [ ] **CRÍTICO · F-02** — `ALTER VIEW public.v_acciones_superadmin SET (security_invoker = true);` y `REVOKE SELECT … FROM authenticated, anon`.
- [ ] **ALTO · F-03** — `ALTER VIEW public.v_usuario_empresa_id SET (security_invoker = true);` o REVOKE de authenticated/anon (evaluar si la vista sigue usándose).
- [ ] **ALTO · F-04** — `ALTER TABLE … FORCE ROW LEVEL SECURITY` en todas las tablas multi-tenant (verificar que ninguna RPC dependa de saltear su propia RLS).
- [ ] **ALTO · F-05** — agregar función `prevent_*` + triggers `BEFORE UPDATE/DELETE` a `operaciones_masivas` (append-only).
- [ ] **ALTO · F-06** — `persistir_cae_y_marcar_emitida`: derivar `empresa_id` desde `auth.uid()` y/o validar `p_empresa_id = get_empresa_id()`; sumar gate de rol.
- [ ] **ALTO · F-07** — `registrar_login`: setear `empresa_id` en el INSERT a `audit_log`.
- [ ] **MEDIO · F-08** — agregar `AND empresa_id = v_empresa_id` al UPDATE de `cerrar_turno`, `forzar_cierre_turno` e `importar_productos_bulk`.
- [ ] **MEDIO · F-09** — evaluar `audit_log.entidad_id text` → `uuid` (o documentar que es polimórfica).
- [ ] **MEDIO · F-10** — agregar `SET search_path TO 'public'` a `reporte_ventas_agregado`, `ventas_totales_filtrados`, `validar_puntos_venta`.
- [ ] **INFO · F-14** — pasar `getEmpresaFeatures` al cliente RLS-scopeado (hardening).
- [ ] **INFO · F-11 / F-12 / F-13** — sin acción; documentados como diseño intencional.
</content>
</invoke>
