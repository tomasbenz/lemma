# Code check Loom Point — 10-may-2026

## Resumen ejecutivo

Alcance: `src/lib/afip/`, `src/lib/queries/`, server actions de
`/admin/ventas/`, `/admin/pedidos/`, `/caja/`, `/api/ventas/`, y
`supabase/migrations/`. Working tree limpio, branch `main`.

Total: **17 hallazgos** — 4 ALTA, 9 MEDIA, 4 BAJA. La tendencia
dominante es **defense in depth multitenant incompleto**: las mutaciones
en `ventas`, `clientes` y `facturas_afip` confían en RLS sin sumar
`.eq('empresa_id', user.empresa_id)` como segundo cerrojo. El segundo
patrón problemático son **UPDATEs de estado que no chequean error**:
quedan dos casos (`estado='rechazada'` en emisión y NC) con el mismo
shape exacto del bug que el PR de hoy arregló para `estado='aprobada'`.

Recomendación de orden de ataque: (1) los dos UPDATEs de
`estado='rechazada'` sin check de error en `emitir-factura-afip.ts` y
`emitir-nota-credito-afip.ts` — son el mismo bug latente del PR que
acabamos de cerrar pero en el path opuesto. (2) Información cruzada
entre tenants en validaciones de CUIT duplicado (`crear-cliente.ts`,
`actualizar-cliente.ts`) — info disclosure. (3) Resto de MEDIA en
batches por archivo.

## Eje 1: Inconsistencias post-PR factura_b

| Severidad | Archivo:línea | Hallazgo | Bug o backcompat | Recomendación |
|---|---|---|---|---|
| MEDIA | `emitir-nota-credito-afip.ts:223` | El check `tipoFacturaOriginal === 'factura_c' && !venta.nombre_cliente_custom` permite `receptor = null` (CF anónimo total) SOLO para C. Para NC sobre `factura_b` cae al else y manda `documento: { tipo: 99, nro: '0' }`. En `emitir-factura-afip.ts:230` el equivalente sí permite null para B. | SOSPECHOSO | Cambiar la condición a `(tipoFacturaOriginal === 'factura_b' || tipoFacturaOriginal === 'factura_c')` para alinear con la emisión. AFIP acepta ambas formas, pero la inconsistencia entre emisión y NC sobre la misma venta puede confundir compliance. |
| BAJA-MEDIA | `emitir-factura-afip.ts:382` | El INSERT inicial a `facturas_afip` guarda `tipo_factura: venta.tipo_factura`. Si la venta arranca como `factura_c` y el remap C→B la lleva a B, el INSERT ya pasó con C. La fila de `facturas_afip` queda con `tipo_factura='factura_c'` mientras que el cbteTipo enviado a AFIP es 6 (B). El UPDATE de sync C→B en línea 217-224 toca solo `ventas`, no `facturas_afip`. | BUG menor de auditoría | Mover el INSERT después del bloque de derivación y usar `tipoFactura` (el ya resuelto). O agregar un UPDATE adicional en el bloque sync C→B para `facturas_afip.tipo_factura`. Solo afecta filas viejas de homo. |
| BAJA | `emitir-factura-afip.ts:307-316` y `emitir-nota-credito-afip.ts:317-323` | Comentarios dicen "descomponerFactura solo conoce `'factura_a'` \| `'factura_c'`". Hoy ya acepta `'factura_b'` (verificado en `calculos.ts:36`). El call pasa `'factura_a'` hardcoded para B también — funcional pero confunde. | SOSPECHOSO (workaround obsoleto) | Reemplazar el hardcode por `tipoFactura` (en emisión) o `tipoFacturaOriginal === 'factura_a' ? 'factura_a' : 'factura_b'` (en NC). Eliminar el comment obsoleto. |
| BAJA | `emitir-nota-credito-afip.ts:295-302` | Ternarios `tipoFacturaOriginal === 'factura_a' ? 'nota_credito_a' : 'nota_credito_b'` y `... ? 1 : 6` agrupan B y C en la misma rama. Funciona porque NC sobre C en Iconic se emite como NC B también, pero no hay comentario que documente la elección. | BACKCOMPAT no documentado | Agregar comentario explicando que B y C colapsan a nota_credito_b por convención Iconic-RI. |

## Eje 2: Persistencia robusta UPDATE en facturas_afip

| Severidad | Archivo:línea | Hallazgo | Recomendación |
|---|---|---|---|
| ALTA | `emitir-factura-afip.ts:403-410` | `await supabase.from('facturas_afip').update({ estado: 'rechazada', ... }).eq('id', facturaId)`. No captura ni chequea `error`. Si el UPDATE falla, la fila queda en `'pendiente'` y la venta no se marca correctamente como fallida. Mismo shape exacto que el bug B del PR del 10-may para el path 'aprobada'. | Aplicar el mismo patrón retry + fallback. Mínimo: capturar `error`, loguear con detalle, y considerar `estado='error'` con `error_mensaje='UPDATE persistencia rechazada falló'`. |
| ALTA | `emitir-nota-credito-afip.ts:379-388` | Mismo patrón en NC: `await supabase.from('facturas_afip').update({ estado: 'rechazada', ... }).eq('id', ncId)` sin check de error. Si falla, la NC queda 'pendiente' aunque AFIP la rechazó, y el flujo de anulación de venta puede quedar inconsistente. | Mismo retry + fallback que el path 'aprobada' de NC (ya implementado en líneas 416-447). Por simetría, todo UPDATE de estado terminal debería usar el patrón robusto. |
| MEDIA | `emitir-factura-afip.ts:364-371` | UPDATE inicial de reintento (estado='pendiente', intentos +1). Si falla, devuelve error genérico "No se pudo actualizar factura previa" sin loguear `errUpd`. Pérdida de info para debugging si esto rompe en prod. | Agregar `console.error('[emitirFacturaAfip] UPDATE retry init falló:', errUpd)` antes del return. |
| BAJA | `emitir-factura-afip.ts:404-410, 466-469` y `emitir-nota-credito-afip.ts:381-385` | Los UPDATE de path rechazada usan solo `.eq('id', facturaId)` sin `.eq('empresa_id', user.empresa_id)`. RLS protege, pero el resto del archivo (path aprobada) sí agrega el filtro como defense in depth. Inconsistente. | Por consistencia, sumar `.eq('empresa_id', user.empresa_id)` a todos los UPDATE de facturas_afip en estos dos archivos. |

## Eje 3: Multitenant defense in depth

| Severidad | Archivo:línea | Hallazgo | Recomendación |
|---|---|---|---|
| ALTA | `crear-cliente.ts:55-60` | Check de CUIT duplicado: `.from('clientes').select('id, razon_social').eq('cuit', data.cuit).eq('activo', true).maybeSingle()` — **sin `.eq('empresa_id', user.empresa_id)`**. RLS de `clientes` debería bloquearlo, pero si la RLS está mal configurada o si hay alguna policy más permisiva, el usuario puede recibir `razon_social` de un cliente de otra empresa en el error message ("Ya existe un cliente con ese CUIT: <razon_social>"). Info disclosure cross-tenant. | Agregar `.eq('empresa_id', user.empresa_id)` al filtro. Mismo patrón S-1/S-2 que ya se aplicó al resto del repo. |
| ALTA | `actualizar-cliente.ts:50-56` | Idéntico al anterior: check de CUIT duplicado al editar, también sin filtro empresa_id. Mismo riesgo de info disclosure. | Idem. |
| MEDIA | `actualizar-cliente.ts:67-80` | UPDATE `clientes` solo con `.eq('id', id)`, sin `.eq('empresa_id', user.empresa_id)`. RLS protege pero falta defense in depth. | Agregar `.eq('empresa_id', user.empresa_id)`. |
| MEDIA | `cambiar-estado-cliente.ts:21-25` | UPDATE `clientes.activo` solo con `.eq('id', id)`, sin filtro empresa_id. | Idem. |
| MEDIA | `marcar-pedido-visto.ts:24-30` | UPDATE `ventas.vista_at` solo con `.eq('id', pedidoId).eq('estado', 'guardada')`. RLS protege. | Agregar `.eq('empresa_id', user.empresa_id)`. |
| MEDIA | `marcar-pedido-visto.ts:65-69` | UPDATE masivo `ventas.vista_at = now()` con `.eq('estado', 'guardada')` — sin filtro empresa_id. Si RLS falla, se marca como vistos pedidos de otras empresas. | Agregar `.eq('empresa_id', user.empresa_id)` — más crítico que el caso anterior porque es UPDATE masivo. |
| MEDIA | `finalizar-pedido.ts:104-108` | UPDATE `ventas.cliente_id` solo con `.eq('id', input.pedidoId).eq('estado', 'guardada')`. | Agregar `.eq('empresa_id', user.empresa_id)`. |
| MEDIA | `lib/queries/facturas-afip.ts:78-85` y `:103-110` | `obtenerFacturaAfip(ventaId)` no recibe ni aplica `empresa_id`. Confía 100% en RLS. La función es server-only y la llaman desde server components. | Aceptar `empresa_id` como parámetro y filtrar explícitamente. Misma deuda que `obtenerVenta` en `queries/ventas.ts`. |

## Eje 4: Lógica fiscal de cálculos

Sin hallazgos en este eje.

Notas de revisión que NO calificaron como bug:
- Tolerancias de 0.02 (suma medios pago) vs 0.05 (prorrateo items) son contextos diferentes, no inconsistencia.
- Patrón "último item absorbe diferencia" idéntico entre emisión y NC, con tolerancia consistente.
- Recargo 10,5% IVA reducido bien guardado con `sin_factura`-check en `cerrar-venta.ts:124` y `finalizar-pedido.ts:77`.
- `descomponerFactura` cubre A y B con misma lógica (÷1.21); C no descompone — coherente con tratamiento fiscal Iconic-RI.

## Eje 5: Endpoints debug / dead code / TODOs

- **NO hay endpoints debug** en `src/app/api/`: `/api/debug/` ya fue eliminado (commit 333d188), no hay `/test/`, `/internal/` ni `/admin-only/`. `/api/ping` es health check legítimo sin auth (documentado).
- **console.log activos en lib/afip** (no clasificar como bug — son intencionales para debugging SOAP):
  - `src/lib/afip/wsfe/index.ts:379, 392`
  - `src/lib/afip/wsfe/parsers.ts:372`
  - `src/lib/afip/wsfe/soap-client.ts:81, 117`
  - `src/lib/afip/wsaa/soap-client.ts:70, 140`
  - `src/lib/afip/wsaa/token-cache.ts:66, 114`
- **TODOs reales** (no comentarios con "TODO" en otra acepción):
  - `src/lib/afip/recovery.ts:77` — "post-Fase-4.b: cuando exista infra de notificaciones (email admin, slack...)"
  - `src/app/api/webhooks/mp/[secret_segment]/route.ts:285` — "mover a queue (Inngest / QStash / pg_cron) cuando se cumpla X"
- **Dead code / imports no usados**: revisado en los archivos fiscales del scope, no encontré imports muertos.
- **Variables exportadas no usadas**: `BadgeFactura` de `src/components/app/badge-factura.tsx` exporta el type `TipoFactura`, pero las 3 declaraciones locales en `page.tsx:39`, `factura-afip-card.tsx:21`, y `_panel-finalizar.tsx` no lo importan — duplican el union manualmente. Detalle de Eje 6.

## Eje 6: Tipos TS desalineados

| Severidad | Archivo:línea | Hallazgo | Recomendación |
|---|---|---|---|
| BAJA | Varios | El union `'factura_a' \| 'factura_b' \| 'factura_c'` aparece literal en 5 archivos: `page.tsx:121`, `factura-pdf/route.ts:137`, `exportar-ventas.ts:183, 232, 250`. Cualquier cambio futuro al dominio requiere actualizar N lugares. | Exportar como `type TipoFacturaConIva` desde `lib/afip/calculos.ts` o `lib/afip/types.ts` e importar. |
| BAJA | `emitir-factura-afip.ts:105-113` y `emitir-nota-credito-afip.ts:99-107` | El cast extendido `'sin_factura' \| 'factura_a' \| 'factura_b' \| 'factura_c' \| 'nota_credito_a' \| ...` duplicado entre los dos archivos como workaround hasta regenerar tipos de Supabase. | Extraer a `TipoFacturaCompleto` en `lib/afip/types.ts`. Eliminar tras regenerar tipos post-migration. |
| BAJA | `badge-factura.tsx:5` vs `page.tsx:39` vs `factura-afip-card.tsx:21` vs `_panel-finalizar.tsx:19` | Tres declaraciones independientes de `type TipoFactura`. `badge-factura.tsx` exporta uno que NADIE importa, los otros declaran locales con el mismo contenido. | Usar el export de `badge-factura.tsx` (o moverlo a `lib/afip/types.ts`) en todos los callers. |
| BAJA | `ventas.ts:127` | `query.eq('tipo_factura', tipoFactura as never)` — workaround porque el enum generado de Supabase aún no tiene `factura_b`. | Regenerar `src/types/database.ts` con `npm run db:types` después de aplicar la migration. Eliminar el `as never`. |

## Hallazgos transversales

- **Patrón sistemático "confiar en RLS sin defense in depth"** en mutaciones de `clientes` y `ventas`. El proyecto tiene una convención clara (CLAUDE.md "Patrón de seguridad en server actions multi-tenant") con guard temprano + pre-check + scope en UPDATE/DELETE. Se aplica bien en `anular-venta.ts`, `asignar-facturacion.ts`, `emitir-factura-afip.ts` (path principal). Falta aplicarlo en los 6 lugares listados en Eje 3 + los UPDATEs de path rechazada del Eje 2.

- **Persistencia robusta sólo cubre el path feliz**. El PR de hoy agregó retry + fallback al UPDATE de `estado='aprobada'`, pero el UPDATE simétrico de `estado='rechazada'` quedó sin protección. Si la DB tiembla justo cuando AFIP rechaza, la fila queda en 'pendiente' indefinidamente y la venta no recibe `marcarVentaFallaFacturacion`. Recomiendo extender el patrón robusto a todos los UPDATEs que muten estado terminal (rechazada, aprobada, anulada_por_nc).

- **Comentarios obsoletos pos-PR factura_b**. Al menos 3 lugares dicen "descomponerFactura solo conoce A | C" cuando ya soporta B. Los hardcode `'factura_a'` siguen funcionando por suerte (misma matemática), pero la deuda de docs aumenta el riesgo de que un refactor futuro toque el hardcode sin entender la semántica.

- **Migration `factura_b` y regeneración de types**. El repo tiene 7+ casts `as never` directamente atribuibles a que `src/types/database.ts` aún no conoce `factura_b` ni `aprobada_sin_persistir`. Cuando se corra `npm run db:types` post-aplicación de la migration, muchos de esos casts pueden eliminarse.

## NO clasificados como hallazgo

- **`factura_c` en `types/database.ts`, `mock.ts`, `real.ts`, `types.ts`** — son la representación canónica del enum (incluye C porque AFIP define cbteTipo 11=C). Backcompat intencional; el valor existe y debe poder representarse aunque Iconic no lo use.

- **El UPDATE de sync C→B en `emitir-factura-afip.ts:217-224` que ignora errores** — está documentado: "Si el UPDATE falla, no abortamos — la emisión va de todas formas". Decisión consciente: la emisión fiscal es lo crítico, la sync de DB es cosmética.

- **`obtenerFacturaAfip` no marca la fila `aprobada_sin_persistir` como visualmente "rota"** — la query la trata igual que `aprobada` para mostrar el CAE. Es comportamiento intencional: el CAE existe fiscalmente, lo único que falló fue el UPDATE de DB. El estado se persiste para reconciliación manual pero la UI prioriza mostrar el CAE.

- **`factura-pdf/route.ts:184` con cbteTipo 6 para C** — backcompat documentado: "Iconic NUNCA emite Factura C real". `factura_c` en DB se renderiza como Factura B en el PDF.

- **`ping/route.ts` sin auth** — documentado en línea 12: "SIN auth: este endpoint solo confirma que el server responde, no expone datos". Health check legítimo.
