# Lemma — Contexto del proyecto

## Qué es
B2B POS multi-tenant para librerías argentinas (papelería, útiles escolares,
materiales de arte, regalería, libros). En Argentina "librería" NO es bookstore:
es papelería + útiles escolares + arte; los productos se identifican por
SKU/código de barras propio, no por ISBN/editorial/autor.
Cliente actual: Librería Samu.

## Stack
- Next.js 16 (App Router), TypeScript estricto
- Supabase (Postgres + RLS + Auth)
- Tailwind v4 + shadcn/ui
- Vercel deploy
- PWA offline-first con Serwist + Dexie (IndexedDB)
- recharts para reportes

## Identidad visual
- Paleta achromatic ESTRICTA: #000000, #FFFFFF, #F0F0F0, #DFDBDB
- Sin color de acento
- Sin scrollbars visibles → clase `.no-scrollbar` en todo overflow

## Arquitectura clave
- Multi-tenant con `empresa_id` + RLS en TODAS las tablas
- Tipos TS generados desde Supabase
- Service worker + IndexedDB cache de catálogo
- Cola de pedidos offline con `/api/sync/orders`
- `limpiarDBLocal()` se ejecuta en logout
- Variantes generalizadas por categoría: `variantes.atributos jsonb` +
  tabla `categoria_atributos` define qué atributos espera cada categoría
  (color, tamaño, presentación, gramaje, etc.)
- Multi-sucursal y multi-caja opcionales (`empresas.multi_sucursal/multi_caja`).
  Para empresas single-local hay sucursal y caja default automáticas.

## Migrations SQL — IMPORTANTE
Versionadas en `supabase/migrations/`. La migración inicial
`00000000000000_init_lemma.sql` consolida el schema base de Lemma.
Cambios de schema se hacen creando un archivo nuevo con timestamp.
NUNCA aplicar a la DB de prod automáticamente — Tomás lo aplica a mano.

Cuando se necesite cambiar schema:
- Generar archivo SQL en `supabase/migrations/` con timestamp y nombre descriptivo
- NUNCA aplicar a la DB de prod automáticamente — Tomás lo aplica a mano

## Estado de seguridad
- RLS ACTIVO en todas las tablas
- 6 funciones SECURITY DEFINER hardeneadas con check `auth.uid() = p_usuario_id`:
  cerrar_venta, guardar_pedido, finalizar_pedido, ajustar_stock, anular_pedido,
  editar_venta, editar_pedido
- Auditoría `sa_*`: REVOKE EXECUTE de PUBLIC/anon/authenticated en las funciones sa_*.
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

## Feature flags por empresa
Tabla `empresas` tiene columna `features jsonb` para flags por tenant.
Helper: `getEmpresaFeatures(empresaId)` y específicos como
`isRecargoManualHabilitado(empresaId)` en `src/lib/features.ts`.

Feature flags actuales soportados:
- `recargo_manual_habilitado`: muestra el toggle de recargo manual y
  el switch de "Cobrar 10,5% extra" en la UI de cobro. Default false.
  El código y columnas (`recargo_porcentaje_manual`, `recargo_motivo`,
  `recargo_factura_completa`, `monto_facturado`, `porcentaje_facturado`)
  quedan dormidos pero funcionales para empresas que activen el flag.

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

## Validación de inputs numéricos del cliente

`if (x < 0)` o `if (x <= 0)` NO bloquea NaN ni Infinity porque cualquier
comparación con NaN devuelve false. Si un payload del cliente trae un
`precioUnitarioNeto: NaN` o `monto: Infinity`, el chequeo lo deja pasar y
el valor basura llega al RPC, produciendo totales corruptos.

Patrón obligatorio para todo monto/cantidad/porcentaje que venga del
cliente y vaya a la DB:

```ts
import { esMontoFinito } from '@/lib/cobro/calculos'

if (!esMontoFinito(item.precioUnitarioNeto) || item.precioUnitarioNeto < 0) {
  return { ok: false, error: 'Precio inválido' }
}
```

`esMontoFinito` envuelve `Number.isFinite()` con un type guard. Para enteros
(cantidades discretas), `Number.isInteger()` ya descarta NaN/Infinity porque
ninguno es entero, así que ahí no hace falta el wrapper.

## Sanitización de `.or()` y `.filter()` de Supabase

`supabase.from('x').or('col.ilike.%foo%,otra.eq.bar')` toma una string
**PostgREST**, no un fragmento SQL escapado. Caracteres como `,`, `*`,
`(`, `)`, `%` reescriben la semántica del filtro. Si la string se construye
con input del usuario sin sanitizar, el usuario puede romper o cambiar
el query.

Helper canónico: `escaparParaOrFilter()` en `src/lib/queries/productos.ts`.
Aplicarlo SIEMPRE antes de interpolar input del usuario en `.or()`:

```ts
const q = escaparParaOrFilter(busqueda.trim())
query.or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`)
```

## Operaciones aritméticas con dinero

Toda operación monetaria en TS debe redondear con `round2()` (de
`src/lib/cobro/calculos.ts`) ANTES de:
- Persistir el resultado a la DB
- Comparar contra otro total con tolerancia `<= 0.02`
- Mostrar en UI

Cálculos en RPCs SQL no necesitan redondeo manual: Postgres usa `numeric`
y los `round(x, 2)` explícitos.

## Race conditions en mutaciones compartidas

Para cualquier mutación de estado compartido (stock, saldo, counter):

- ❌ `SELECT col; if (...) UPDATE SET col = nuevo` — leak de lost update
- ✓ `UPDATE ... SET col = col - X WHERE ... AND col >= X` — atómico
- ✓ Encapsular en RPC con `SELECT FOR UPDATE` + UPDATE en la misma tx

El decremento de stock en `cerrar_venta` y `finalizar_pedido` ya usa el
patrón seguro dentro de la RPC. Cualquier futuro consumer que toque stock
desde TS debe pasar por una RPC, no replicar SELECT + UPDATE.
