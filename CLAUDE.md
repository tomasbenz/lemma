# Loom Point — Contexto del proyecto

## Qué es
B2B POS multi-tenant para showrooms mayoristas de indumentaria.
Cliente actual: Design Plus (Avellaneda).

## Stack
- Next.js 16 (App Router), TypeScript estricto
- Supabase (Postgres + RLS + Auth)
- Tailwind v4 + shadcn/ui
- Vercel deploy
- PWA offline-first con Serwist + Dexie (IndexedDB)
- recharts para reportes

## Identidad visual (Design Plus)
- Paleta achromatic ESTRICTA: #000000, #FFFFFF, #F0F0F0, #DFDBDB
- Sin color de acento
- Sin scrollbars visibles → clase `.no-scrollbar` en todo overflow

## Arquitectura clave
- Multi-tenant con `empresa_id` + RLS en TODAS las tablas
- Tipos TS generados desde Supabase
- Service worker + IndexedDB cache de catálogo
- Cola de pedidos offline con `/api/sync/orders`
- `limpiarDBLocal()` se ejecuta en logout

## Migrations SQL — IMPORTANTE
NO están versionadas actualmente (deuda técnica).
Cambios de schema se hacen directo en SQL editor de Supabase Cloud.
Plan a futuro: empezar a versionar en `supabase/migrations/` para que 
cambios de schema queden en Git.

Cuando se necesite cambiar schema:
- Generar archivo SQL en `supabase/migrations/` con timestamp y nombre descriptivo
- NUNCA aplicar a la DB de prod automáticamente — Tomás lo aplica a mano

## Estado de seguridad
- RLS ACTIVO en todas las tablas (tabla `usuarios` se arregló el 28/04)
- Política `mp_webhooks_select` permisiva — DROPEADA
- 6 funciones SECURITY DEFINER hardeneadas con check `auth.uid() = p_usuario_id`:
  cerrar_venta, guardar_pedido, finalizar_pedido, ajustar_stock, anular_pedido
- Endpoint debug `/api/debug/rls-usuarios` ELIMINADO (commit 333d188)
- Función SQL `debug_rls_contexto()` ELIMINADA de Supabase
- Auditoría `sa_*` COMPLETADA (phase 5b, 03/05/2026):
  REVOKE EXECUTE de PUBLIC/anon/authenticated en las 5 funciones sa_*.
  Defense in depth: permisos Postgres + check interno es_superadmin().
  Solo invocables desde server-side con service role.

## Roles
- admin, vendedora (con o sin facturación habilitada), superadmin

## LEY 1°
Vos decidís el siguiente paso, justificás breve, y lo hacés.
NO me presentes opciones para que elija. NO pidas confirmación en decisiones técnicas/UX.
Decisión + justificación corta + solución, en ese orden.

## Convenciones de trabajo
- Archivos completos siempre, no diffs parciales
- PowerShell con `-LiteralPath` para paths con espacios
- Idioma: rioplatense (vos, dale, joya)
- Credenciales en `.env.local`

## Pendientes
- **Inline edits a `modal-cobro.tsx`**: workflow vendedora-sin-facturación
- **Feature VAT/invoicing** para Design Plus (esperando questionnaire del cliente)
- **Deuda técnica**: introducir flujo de migrations versionadas en `supabase/migrations/`

## Patrón de seguridad en server actions multi-tenant

Cualquier server action o API route que reciba un `id` desde el cliente 
(venta, pedido, variante, cliente, factura, etc.) y lo use para query 
o mutación, debe seguir este patrón:

1. Guard temprano: `if (!user.empresa_id) return { ok: false, error: '<msg genérico>' }`
2. Pre-check explícito: SELECT con `.eq('id', <id>).eq('empresa_id', user.empresa_id).maybeSingle()`
3. Si pre-check no matchea → mismo error genérico (no filtra existencia)
4. Para queries que mutan (UPDATE/DELETE/RPC) → además del pre-check, 
   agregar `.eq('empresa_id', user.empresa_id)` a la mutación misma 
   (defense in depth doble)

Mensajes genéricos a usar (consistencia entre endpoints):
- ventas → 'La venta no existe'
- pedidos (= ventas con estado='guardada') → 'El pedido no existe'
- variantes → 'La variante no existe'
- clientes → 'El cliente no existe'
- productos → 'El producto no existe'
- facturas → 'La factura no existe'

Razón: aunque RLS cubra el caso, defense in depth + error indistinguible 
entre "no existe" y "es de otra empresa" previene information disclosure 
y bugs por configuración mal hecha de RLS.

Aplicado en S-1 (PR feb-may 2026) y S-2 (PR may 2026).
