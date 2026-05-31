# Feature: Aumento por proveedor con desglose por categoría

> **Paso 1 — Relevamiento y diseño.** Documento de propuesta, NO de implementación.
> Relevado contra el código en `P:\Programacion\lemma` y la DB de prod de Samu
> (empresa `11111111-1111-1111-1111-111111111111`) el 2026-05-31.

## Resumen ejecutivo

El caso de uso ("el proveedor me subió 15% los marcadores, 8% los cuadernos, 12% las
cartucheras") es un **aumento con un % distinto por categoría, aplicado de una sola pasada**.

Hallazgo central: **Lemma ya tiene casi toda la infraestructura.** Existe `productos_bulk_update`
con la acción `precio_pct` (sube/baja un % a un set de productos), un store de selección masiva,
una barra de acciones flotante, diálogos de preview editable y auditoría en `operaciones_masivas`.
Lo que **no** existe es la ergonomía de "cargar todos los % por categoría juntos, ver un preview
combinado y ejecutarlo como una sola operación auditada/reversible".

Por lo tanto esta feature es **una pantalla nueva que orquesta piezas existentes**, no un sistema
desde cero. El grueso del trabajo es UX + una RPC nueva que haga el desglose por categoría en una
sola transacción con redondeo y registro reversible.

Tres datos de la DB que definen el diseño:

1. **No existe entidad "proveedor".** Solo `marcas`. (Detalle en §2.1.)
2. **0 variantes con `precio_neto_override`** sobre 6659 productos. El precio vive 100% en
   `productos.precio_neto`. El aumento toca una sola columna.
3. **4 productos activos sin categoría** (exactamente los ambiguos) y **917 inactivos, todos sin
   categorizar**. Filtrar por categoría los excluye naturalmente.

---

## 1. Estado actual relevado

### 1.1 Modelo de datos

#### Conteos reales en prod (Samu)

Verificado con query directa (service role, read-only):

| Métrica | Valor |
|---|---|
| Productos totales | 6659 |
| Productos activos | 5742 |
| Productos inactivos | 917 |
| Activos **con** categoría | **5738** |
| Activos **sin** categoría | **4** (los ambiguos) |
| Inactivos sin categoría | 917 (el 100%) |
| Categorías definidas (`catalogo_categorias`) | **39** |
| Variantes totales | 6659 (≈ 1 por producto) |
| **Variantes con `precio_neto_override`** | **0** |
| Activos **sin** costo cargado | 2547 (~44%) |

#### `marcas` — NO hay tabla `proveedores`

`supabase/migrations/00000000000014_rediseño_catalogo_marca_categoria.sql:42-52`

```sql
CREATE TABLE IF NOT EXISTS public.marcas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,
  orden integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre_normalizado)
);
```

No existe ninguna tabla `proveedores`/`suppliers` ni columna `proveedor_id` en `marcas` ni en
`productos`. El único concepto de "origen" del producto es **marca** (`productos.marca_id → marcas.id`,
nullable). Confirmado también en Loom Point (proyecto hermano): tampoco tiene proveedores.

#### `productos` — un solo precio, costo nullable

`src/types/database.ts:1104-1182` (schema autoritativo). Columnas relevantes:

| Columna | Tipo SQL | Notas |
|---|---|---|
| `precio_neto` | `numeric(14,2) NOT NULL DEFAULT 0` | **Único precio.** No hay mayorista/minorista. |
| `costo` | `numeric(12,2)` nullable | Agregado en migración 15. Para margen. ~44% en NULL. |
| `alicuota_iva` | `numeric(5,2) NOT NULL DEFAULT 21` | No se toca en aumentos. |
| `marca_id` | `uuid` nullable → `marcas` | Proxy de proveedor. |
| `categoria_id` | `uuid` nullable → `catalogo_categorias` | El eje del desglose. |
| `activo` | `boolean` | Filtro obligatorio. |

#### `variantes` — sin costo propio, override casi inexistente

`src/types/database.ts:1407-1469`

```sql
CREATE TABLE variantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  producto_id uuid NOT NULL REFERENCES productos(id),
  atributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku_variante text,
  precio_neto_override numeric(14,2),   -- nullable, HOY 0 filas lo usan
  stock integer NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  ...
);
```

- El precio efectivo es `COALESCE(variantes.precio_neto_override, productos.precio_neto)`.
- **No hay costo a nivel variante** — el costo vive solo en `productos.costo`.
- En Samu hoy **ningún** producto usa override → en la práctica el precio está 100% en `productos`.

#### `catalogo_categorias`

`src/types/database.ts:240-279` — `id, empresa_id, nombre, nombre_normalizado, orden, activo, timestamps`.
Curadas por empresa (ABM manual), `UNIQUE(empresa_id, nombre_normalizado)`. Samu: 39 activas.

#### Auditoría existente — NO hay tabla de historial de precios

- **No existe** `productos_precio_historial` ni trigger sobre precio/costo.
- `audit_log` (`src/types/database.ts:132-200`): genérica, **inmutable** (triggers
  `prevent_audit_changes` bloquean UPDATE/DELETE — `00000000000003_...:294-303`).
- **`operaciones_masivas`** (`00000000000010_operaciones_masivas.sql:27-40`) es la tabla de
  auditoría de operaciones bulk. Una fila por operación:

```sql
CREATE TABLE public.operaciones_masivas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_email_snapshot text NOT NULL,
  accion text NOT NULL,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_solicitados integer NOT NULL DEFAULT 0,
  afectados integer NOT NULL DEFAULT 0,
  cantidad_omitidos integer NOT NULL DEFAULT 0,
  omitidos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ids_afectados jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_at timestamptz NOT NULL DEFAULT now()
);
```

> ⚠️ `operaciones_masivas` guarda **qué ids** se afectaron pero **no el precio anterior**.
> Para reversibilidad hace falta extenderla (ver §2.3).

#### RPCs existentes que tocan precio

| RPC | Migración | Firma | Qué hace |
|---|---|---|---|
| `productos_bulk_update` | 14 | `(p_usuario_id uuid, p_accion text, p_ids uuid[], p_params jsonb)` | `accion='precio_pct'` → `precio_neto * (1+pct/100)`, `round(,2)`; también `precio_fijo`, `cambiar_marca/categoria/activo`. Audita en `operaciones_masivas`. |
| `productos_bulk_precio_individual` | 10 | `(p_usuario_id uuid, p_cambios jsonb)` | Set-based, `[{id, precio}]`, un precio por fila. Audita. |
| `productos_bulk_import` | 16 | `(p_usuario_id uuid, p_cambios jsonb)` | Import por `sku_variante`, precio+costo opcionales. |
| `importar_productos_bulk` | 16 | `(p_usuario_id uuid, p_productos jsonb)` | Alta/update por `sku_base`. |

El UPDATE de `precio_pct` (núcleo a reutilizar conceptualmente):

```sql
UPDATE public.productos
SET precio_neto = round(v_precio, 2)
WHERE id = ANY(v_validos) AND empresa_id = v_empresa_id;
```

### 1.2 Código actual

#### Acciones bulk (server actions)

- `src/app/(app)/admin/productos/_actions/bulk-actualizar-productos.ts:62-219`
  `bulkActualizarProductos(input)` — union discriminada: `precio_pct | precio_fijo |
  cambiar_marca | cambiar_categoria | cambiar_activo | stock_*`. Valida permisos
  (`puedeEditarCatalogo()`), cap **1000 productos**, `pct >= -100`. Llama
  `rpc('productos_bulk_update')` / `rpc('productos_bulk_stock')`.
- `src/app/(app)/admin/productos/_actions/bulk-actualizar-individual.ts:69-158`
  `bulkActualizarProductosIndividual(input)` — `precio_individual | stock_individual`, cap 1000,
  valida con `esMontoFinito()`. Llama `rpc('productos_bulk_precio_individual')`.
- `src/app/(app)/admin/productos/_actions/actualizar-precio.ts:11-50`
  `actualizarPrecio(productoId, precio)` — un solo producto, redondea
  `Math.round(precio*100)/100`, UPDATE directo.

#### Edición de precio de un producto (validación de referencia)

`src/lib/validations/producto.ts:91-94`:

```ts
precio_neto: z.number().min(0, 'No puede ser negativo').max(99999999, 'Precio demasiado alto'),
costo: z.number().nullable().optional().refine((v) => v == null || v >= 0, {
  message: 'El costo no puede ser negativo',
}),
```

Helpers monetarios: `esMontoFinito()` y `round2()` en `src/lib/cobro/calculos.ts` (per CLAUDE.md,
obligatorios antes de persistir/comparar/mostrar).

#### Selección masiva en UI — **existe y es reusable**

- Store Zustand fuera del árbol React: `_state/seleccion-productos-store.ts`
  (`{ ids: Set<string>, toggle, setPagina, agregarMuchos, limpiar }`, hooks
  `useSeleccionTiene/Cantidad`, tri-state `useEstadoPagina`).
- `_components/fila-checkbox.tsx`, `seleccion-header-checkbox.tsx` (tri-state),
  `seleccion-banner.tsx` ("Seleccionar X del filtro", cap 1000).
- `_components/bulk-bar-productos.tsx:62-501` — barra flotante con menú de acciones, dispara los
  diálogos.

### 1.3 UX patterns reusables

#### Patrón "panel de filtros + visualización" (reportes)

`src/app/(app)/admin/reportes/` — `page.tsx` (server: valida rol, `Promise.all` de queries,
Suspense) + `_components/reportes-view.tsx` (client: presets de período como botones, selects,
filtros URL-driven con `router.replace()` + `useTransition()`, KPIs + gráficos + tablas). Es el
molde más cercano para una pantalla "filtros arriba, tabla/acción abajo".

#### Filtros en lista de productos

`_components/productos-view.tsx` ya filtra por: búsqueda `q`, `estado` (activo/todos),
`stock` bajo, `cat_asignada` (sin/con/todas), **`marca`** (DropdownMenu+RadioGroup, dinámico de
`listarMarcas`), **`categoria`** (idem, `listarCategoriasReales`), `orden`, paginación. O sea: ya
hay queries y componentes para listar marcas y categorías de la empresa.

#### Preview / confirmación antes de acción masiva — **existe**

Flujo Fase 2 (precio %): `bulk-regla-dialog.tsx` (ingresar regla) →
`obtenerPreviewProductos(ids)` → `bulk-preview-dialog.tsx` (tabla editable: precio actual →
precio nuevo, override por fila, badge "se omitirá", botón revertir) → confirmar →
`bulkActualizarProductosIndividual()`. Confirmaciones simples vía `bulk-accion-dialog.tsx`
(shadcn `AlertDialog`). Componentes base en `src/components/ui/{alert-dialog,dialog}.tsx`.

#### Selects reusables

- `FormCatalogoSelect` (`_components/bulk-forms.tsx:61-94`) — select shadcn con opción "sin X".
- `ComboboxCatalogo` (`src/components/app/combobox-catalogo.tsx`) — combobox con fuzzy + crear nuevo.
- Patrón DropdownMenuRadioGroup para filtros de marca/categoría (`productos-view.tsx`).

### 1.4 Referencia Loom Point

`P:\Programacion\loom-point` (predecesor de Lemma). **No implementó aumento masivo de precios.**
Tiene: `actualizarPrecio` (individual, redondea a 2 decimales) e `importar_productos_bulk` (alta/update
por CSV con validación en 2 fases + atomicidad — buen patrón de referencia para validar-todo-antes-de-aplicar).
**No tiene** tabla `proveedores`, ni ajuste por %, ni auditoría de cambios de precio, ni reversibilidad.
Conclusión: no hay nada que portar directo; la decisión "proveedor vs marca" es nueva y se resuelve
con el schema de Lemma, no con Loom Point.

---

## 2. Propuesta de diseño

### 2.1 Decisión clave: ¿proveedor o marca?

**Decisión: usar `marca` como eje de scoping (opcional), sin crear entidad `proveedor` en Fase 1.**

Justificación:

1. **La DB no tiene proveedores.** Crear `proveedores` + `marcas.proveedor_id` + ABM + backfill de
   5738 productos es una feature en sí misma, fuera de scope.
2. **En una librería chica, marca ≈ proveedor.** Samu compra "los Filgo" al distribuidor de Filgo.
   El scoping por marca cubre el caso real ("el proveedor me subió los marcadores Filgo 15%").
3. **El verdadero diferenciador del pedido es la categoría, no el proveedor.** El proveedor solo
   acota *qué* productos; el % distinto viene *por categoría*. Eso se modela perfecto con
   marca (filtro opcional) + categoría (eje del desglose).

Diseño defensivo a futuro: la operación se guarda con `marca_id` (nullable) en los parámetros, así
que si más adelante se introduce `proveedores`, migrar el scope es directo. **Pregunta para Tomás en
§3.1** por si un proveedor abarca varias marcas (ahí sí haría falta la entidad).

### 2.2 Flujo de usuario propuesto

1. Admin entra a **Catálogo → Aumentos** (pantalla nueva).
2. (Opcional) elige una **marca/proveedor** para acotar. Si no elige → todas las marcas.
3. Ve una **tabla de categorías** (solo las que tienen productos en ese scope), con:
   `Categoría · # productos · % aumento (input) · precio prom. actual → estimado`.
4. Carga el **% por categoría** en las que quiera (vacío = no se toca). Opcional: campo "% a todas".
5. Elige **redondeo**: Sin redondeo · A $10 · A $50 · A $100.
6. Click **"Previsualizar"** → diálogo con: total de productos afectados, desglose por categoría,
   ejemplos viejo→nuevo, y aviso de excluidos (sin categoría / inactivos).
7. **Confirmar** → ejecuta, toast con resultado, queda registrada y **reversible** por una ventana.

```
┌─ Catálogo › Aumentos ────────────────────────────────────────────┐
│ Proveedor/Marca: [ Todas ▾ ]        Redondeo: [ A $10 ▾ ]         │
│ % a todas las categorías: [    ] (opcional)                       │
│                                                                   │
│  Categoría            # prod   % aum.   Prom. actual → estimado   │
│  ───────────────────────────────────────────────────────────────  │
│  Marcadores            312     [15 ]    $1.240  →  $1.430         │
│  Cuadernos             188     [ 8 ]    $3.100  →  $3.350         │
│  Cartucheras            74     [12 ]    $8.900  →  $9.970         │
│  Lápices               401     [   ]    $480    →  —  (sin cambio)│
│  …                                                                 │
│  ───────────────────────────────────────────────────────────────  │
│  4 productos sin categoría no se verán afectados.                 │
│                                   [ Previsualizar 574 cambios → ] │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 Modelo de datos: cambios sugeridos

Reusar `operaciones_masivas` para la cabecera (con `accion='aumento_categoria'` y `parametros`
guardando `{ marca_id, redondeo, ajustes:[{categoria_id, pct}] }`). Para **reversibilidad** hace
falta guardar el precio anterior por producto → **tabla nueva de detalle**:

```sql
-- supabase/migrations/000000000000XX_aumentos_por_categoria.sql
CREATE TABLE IF NOT EXISTS public.operaciones_masivas_precio_detalle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL REFERENCES public.operaciones_masivas(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  categoria_id uuid REFERENCES public.catalogo_categorias(id) ON DELETE SET NULL,
  precio_anterior numeric(14,2) NOT NULL,
  precio_nuevo    numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_op_precio_detalle_operacion ON public.operaciones_masivas_precio_detalle(operacion_id);
-- + RLS por empresa_id (patrón estándar del proyecto) + columna revertida_at en operaciones_masivas.
```

Alternativa más liviana sin tabla nueva: snapshot `[{id, ant, nuevo}]` en un JSONB de
`operaciones_masivas`. Se descarta para Samu porque una operación puede tocar miles de filas y el
JSONB gigante es incómodo de consultar/revertir. **Recomendación: tabla de detalle** (decisión en §3.4).

### 2.4 Server actions / RPCs a crear

**RPC 1 — preview (read-only):**
```
productos_preview_aumento_categoria(
  p_empresa_id uuid, p_marca_id uuid, p_ajustes jsonb  -- [{categoria_id, pct}]
) RETURNS jsonb  -- por categoría: {categoria_id, nombre, n_productos, prom_actual, prom_estimado}
```
> Alternativa: resolver el preview en TS con queries `count`+`avg` agrupadas. Recomiendo RPC para
> que el redondeo del preview sea idéntico al del apply.

**RPC 2 — aplicar (núcleo):**
```
aumentar_precios_por_categoria(
  p_usuario_id uuid,
  p_marca_id uuid,            -- NULL = todas las marcas
  p_ajustes jsonb,           -- [{categoria_id, pct}]
  p_redondeo text,           -- 'none'|'r10'|'r50'|'r100'
  p_motivo text
) RETURNS jsonb              -- {ok, operacion_id, afectados, por_categoria:[...], omitidos}
```
Hace, en **una transacción**: valida (auth.uid()=p_usuario_id, pct finitos, categorías de la empresa),
`UPDATE productos SET precio_neto = redondear(precio_neto*(1+pct/100)) WHERE activo AND categoria_id=...
AND empresa_id=... [AND marca_id=...]`, inserta cabecera en `operaciones_masivas` + filas en
`operaciones_masivas_precio_detalle`.

**RPC 3 — revertir (opcional, §3.5):**
```
revertir_aumento_precios(p_usuario_id uuid, p_operacion_id uuid) RETURNS jsonb
```
Restaura `precio_anterior` desde el detalle si está dentro de la ventana y no fue revertida.

**Server actions (TS):**
- `_actions/preview-aumento-categoria.ts` → `previewAumentoCategoria(input)`
- `_actions/aplicar-aumento-categoria.ts` → `aplicarAumentoCategoria(input)` (permisos + `esMontoFinito`)
- `_actions/revertir-aumento.ts` → `revertirAumento(operacionId)` (opcional)

### 2.5 UI: árbol de componentes

**Ruta nueva:** `src/app/(app)/admin/productos/aumentos/`

```
aumentos/
├── page.tsx                         (server: valida rol, carga marcas + categorías con conteos)
├── _components/
│   ├── aumento-view.tsx             (client: selector marca + tabla categorías + redondeo)   NUEVO
│   ├── aumento-tabla-categorias.tsx (filas: categoría, #, input %, estimado)                 NUEVO
│   ├── aumento-preview-dialog.tsx   (preview combinado + confirmar)                          NUEVO
│   └── aumento-redondeo-select.tsx  (Sin / $10 / $50 / $100)                                 NUEVO
├── _actions/
│   ├── preview-aumento-categoria.ts                                                          NUEVO
│   ├── aplicar-aumento-categoria.ts                                                          NUEVO
│   └── revertir-aumento.ts          (opcional)                                               NUEVO
```

**Reusar:** `FormCatalogoSelect`/DropdownMenuRadioGroup (marca), `bulk-preview-dialog`/`AlertDialog`
como base del diálogo, `NumericInput`, layout de `reportes-view`, helpers `round2`/`esMontoFinito`,
queries `listarMarcas`/`listarCategoriasReales`, entrada en el menú/nav de catálogo (archivo a tocar).

### 2.6 Edge cases identificados

| Caso | Comportamiento propuesto |
|---|---|
| **Productos sin categoría** (4 activos) | **Excluidos** (no matchean ninguna categoría). Mostrar nota "N sin categoría no se ven afectados" + link para categorizarlos. |
| **Stock 0** | Se aumentan igual — el precio no depende del stock. |
| **Productos inactivos** (917) | **Excluidos** por `activo=true` en la RPC. Además hoy ninguno tiene categoría, así que no aparecen. |
| **Variantes con `precio_neto_override`** | Hoy 0 filas. Defensivo: la RPC también ajusta el override con el mismo % si no es NULL, para no dejar precios inconsistentes a futuro (decisión en §3.8). |
| **Redondeo** | Configurable; default **A $10** redondeo al más cercano (`round(p/10)*10`). Ver §3.3. |
| **Reversibilidad** | Detalle con `precio_anterior` permite revertir dentro de una ventana (§3.5). |
| **NaN/Infinity en pct** | Bloquear con `esMontoFinito()` en la action y validación en la RPC (CLAUDE.md). |
| **pct = 0 o vacío** | Categoría sin cambio (no entra al UPDATE). |
| **Precio resultante = anterior tras redondeo** | No se cuenta como "afectado" / no se escribe detalle (evita ruido y reversa sin efecto). |

---

## 3. Decisiones que requieren input de Tomás antes de implementar

### 3.1 ¿Proveedor como entidad o marca como proxy?
- **Recomendación:** usar **marca** como proxy, sin tabla `proveedores` en Fase 1. La DB no tiene
  proveedores y marca cubre el caso real en una librería.
- **Alternativas:** (a) crear `proveedores` + `marcas.proveedor_id` + ABM + backfill (mucho scope);
  (b) ignorar el scoping y aumentar siempre sobre todo el catálogo por categoría (más simple, pero
  no refleja "me lo subió *este* proveedor").
- **Disparador para reconsiderar:** si un proveedor de Samu abarca **varias marcas**, marca deja de
  alcanzar → ahí sí conviene la entidad.

### 3.2 ¿Aumento sobre precio, sobre costo, o ambos?
- **Recomendación:** **solo `precio_neto`** en Fase 1. Justificación: 2547 productos activos (~44%)
  **no tienen costo cargado**, así que un aumento "sobre costo" no aplicaría a casi la mitad del
  catálogo y daría resultados inconsistentes.
- **Alternativas:** aumentar también `costo` con el mismo % (refleja la suba real del proveedor, pero
  solo donde hay costo); o un modo "recalcular precio desde costo + margen objetivo" (feature aparte).

### 3.3 Redondeo
- **Recomendación:** opciones **Sin redondeo / A $10 / A $50 / A $100**, default **A $10 al más
  cercano** (`round(p/10)*10`). En Argentina con inflación alta los precios de librería suelen
  terminar en $0 y se redondea a la decena/cincuentena. "Al más cercano" en vez de `floor` para no
  comerse margen sistemáticamente.
- **Alternativas:** redondeo **hacia arriba** (`ceil`) para nunca perder margen; o terminación
  psicológica (`…90`/`…99`) — menos común en B2B de librería.
- **Nota:** todo cálculo monetario en TS debe pasar por `round2()` (CLAUDE.md); en SQL usar
  `round(x,2)` + la fórmula de redondeo a decena elegida.

### 3.4 Audit log: ¿tabla nueva o reusar?
- **Recomendación:** **reusar `operaciones_masivas`** para la cabecera + **tabla nueva
  `operaciones_masivas_precio_detalle`** para el `precio_anterior` por producto (necesaria para
  revertir). Mínimo schema nuevo, máximo reuso.
- **Alternativas:** snapshot JSONB dentro de `operaciones_masivas` (sin tabla nueva, pero pesado y
  difícil de consultar con miles de filas).

### 3.5 Reversibilidad: ¿se permite y en qué ventana?
- **Recomendación:** **sí, reversible**, con botón "Deshacer" disponible **mientras sea la última
  operación de aumento de la empresa** (o ventana de **24–48 h**), y solo si ningún producto fue
  editado manualmente después. Restaura `precio_anterior` del detalle.
- **Alternativas:** sin undo (más simple, pero un error en un % afecta cientos de precios y obliga a
  re-importar); o undo ilimitado en el tiempo (riesgo de pisar cambios posteriores).
- **Pregunta concreta:** ¿alcanza con deshacer *solo la última* operación, o querés un historial con
  reversa selectiva?

### 3.6 Productos sin categoría
- **Recomendación:** **excluirlos** y avisarlos en pantalla ("4 productos sin categoría no se ven
  afectados", con link para categorizarlos). Son 4 activos hoy.
- **Alternativas:** mostrarlos en una pseudo-fila "Sin categoría" con su propio % (permite aumentarlos
  igual); o bloquear la operación hasta categorizarlos (demasiado rígido por solo 4).

### 3.7 Productos inactivos
- **Recomendación:** **no aumentar inactivos** (`activo=true` en la RPC). Hoy los 917 inactivos
  además no tienen categoría, así que quedan fuera por partida doble.
- **Alternativa:** checkbox "incluir inactivos" para quien quiera dejar precios al día antes de
  reactivar — de baja prioridad.

### 3.8 Variantes con `precio_neto_override`
- **Recomendación:** ajustar **también** el `precio_neto_override` (con el mismo %) cuando no sea
  NULL, para no dejar variantes con precio viejo. Impacto hoy = **0 filas**, es puramente defensivo.
- **Alternativa:** ignorar overrides (documentando que quedan sin tocar). Dado que hoy no se usan, es
  una decisión de bajo riesgo; conviene fijar la política igual.

### 3.9 ¿Cómo se llama y dónde vive en el menú?
- **Recomendación:** **"Aumentos"** dentro de Catálogo/Productos, ruta
  `/(app)/admin/productos/aumentos`. Acceso solo admin/superadmin (no vendedora).
- **Alternativas:** "Aumento masivo", "Ajuste de precios", o vivir dentro de la barra bulk existente
  (se descarta: el desglose por categoría no encaja en el flujo de "seleccionar filas").

### 3.10 ¿Permitir aumentos negativos (descuentos)?
- **Recomendación:** **sí**, permitir % negativo (con `pct > -100`), reutilizando la misma pantalla.
  Cubre "bajó el dólar / liquidación de temporada".
- **Alternativas:** restringir a positivos y hacer una pantalla aparte de descuentos (innecesario:
  es el mismo mecanismo con signo distinto). Sí conviene un **confirm extra** si algún % es negativo,
  para evitar errores de tipeo.

---

## 4. Estimación

Asume las recomendaciones de §3 (marca como proxy, solo precio, redondeo configurable, reuso de
`operaciones_masivas` + tabla de detalle, undo de última operación).

| Capa | Detalle | Archivos | LOC aprox |
|---|---|---|---|
| **DB migration** | 1 archivo: tabla detalle + RLS + `aumentar_precios_por_categoria` + `productos_preview_aumento_categoria` + `revertir_aumento_precios` + `revertida_at` | 1 nuevo | 250–350 |
| **Server actions** | preview + aplicar + revertir | 3 nuevos | 180–260 |
| **UI** | page + view + tabla categorías + preview dialog + redondeo select | 5 nuevos | 550–750 |
| **Queries/helpers** | conteos por categoría dentro de marca, fórmula redondeo TS | 1 nuevo + 1 tocado | 80–120 |
| **Nav/menú** | entrada "Aumentos" | 1 tocado | ~15 |
| **Tests** | redondeo ($10/$50/$100, ceil vs nearest), aplicación de pct, exclusiones | 1–2 nuevos | 150–220 |
| **`db:types`** | regenerar `src/types/database.ts` | 1 tocado (generado) | — |

**Totales:** ~**11–13 archivos nuevos**, ~**4 tocados**, **~1200–1700 LOC**. Riesgo bajo-medio: el
grueso es UI + una RPC bien acotada; la infra de bulk/preview/auditoría ya existe y se reusa.
La parte más delicada es la reversibilidad (correctitud del detalle + ventana).

**Sugerencia de fasing:** Fase A (MVP) = pantalla + preview + apply + auditoría, **sin undo**
(~900 LOC). Fase B = reversibilidad + tests de redondeo. Permite poner la feature en manos de Samu
rápido y agregar el undo una vez validado el flujo.

---

## Observaciones colaterales

> Hallazgos durante el relevamiento. **No se tocó nada** — anotados para decidir aparte.

1. **`actualizar-producto.ts` no redondea `precio_neto` antes del UPDATE.** A diferencia de
   `actualizar-precio.ts` (que hace `Math.round(precio*100)/100`), la edición completa de producto
   (`[id]/editar/_actions/actualizar-producto.ts:108`) persiste `data.precio_neto` directo del form.
   CLAUDE.md exige `round2()` antes de persistir. Inconsistencia menor (el form ya limita decimales),
   pero conviene unificar con `round2()`.

2. **2547 productos activos (~44%) sin costo.** El indicador de margen
   (`(precio_neto - costo)/precio_neto`) no aplica para casi la mitad del catálogo. No es bug, pero
   limita cualquier feature futura basada en costo/margen (incluido "aumentar sobre costo").

3. **917 inactivos, todos sin categorizar.** Si se reactivan en el futuro, no aparecerán en aumentos
   por categoría hasta que se les asigne categoría. Vale tenerlo presente para el flujo de reactivación.

4. **`operaciones_masivas` no guarda valores anteriores.** Las operaciones bulk de precio existentes
   (`precio_pct`, `precio_individual`) **no son reversibles hoy** — solo registran ids afectados. Si
   se valora la reversibilidad, la tabla de detalle de §2.3 beneficiaría también a esas operaciones
   (fuera de scope de esta feature, pero es la misma necesidad).
