// Helpers puros para export/import Excel de productos (Fase 3).
// Sin React ni capa de datos: testeables con node:test.

import type { ProductoFilaExport } from '@/lib/queries/productos'
import type {
  CambioImport,
  EstadoActualImport,
} from '../_actions/importar-actualizar'

export type ColumnaExport =
  | 'sku_base'
  | 'sku_variante'
  | 'nombre'
  | 'atributos'
  | 'categoria'
  | 'precio_neto'
  | 'stock'
  | 'activo_producto'
  | 'activa_variante'
  | 'codigo_barras'

export const COLUMNAS_EXPORT: ColumnaExport[] = [
  'sku_base',
  'sku_variante',
  'nombre',
  'atributos',
  'categoria',
  'precio_neto',
  'stock',
  'activo_producto',
  'activa_variante',
  'codigo_barras',
]

// Columnas product-level: si difieren entre filas del mismo sku_base, conflicto.
const COLUMNAS_PRODUCTO = ['precio_neto', 'categoria', 'activo_producto'] as const

const SI = 'Sí'
const NO = 'No'

// ============================================================
// Export: filas → objetos para la hoja
// ============================================================

/**
 * Convierte las filas del export al objeto por fila para xlsx. Booleanos como
 * 'Sí'/'No'; sku/codigo_barras como string (xlsx los fuerza a texto aparte).
 */
export function filasAObjetos(
  filas: ProductoFilaExport[]
): Record<ColumnaExport, string | number>[] {
  return filas.map((f) => ({
    sku_base: f.sku_base,
    sku_variante: f.sku_variante,
    nombre: f.nombre,
    atributos: f.atributos,
    categoria: f.categoria ?? '',
    precio_neto: f.precio_neto,
    stock: f.stock,
    activo_producto: f.activo_producto ? SI : NO,
    activa_variante: f.activa_variante ? SI : NO,
    codigo_barras: f.codigo_barras ?? '',
  }))
}

// ============================================================
// Parsers
// ============================================================

function parseNumero(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw ?? '').trim()
  if (s === '') return null
  // Formato AR: '.' miles, ',' decimal. Si hay coma, es el decimal.
  const norm = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

function parseEntero(raw: unknown): number | null {
  const n = parseNumero(raw)
  if (n === null) return null
  return Number.isInteger(n) ? n : null
}

function parseBool(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (['sí', 'si', 's', 'true', '1', 'verdadero'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'falso'].includes(s)) return false
  return null
}

// ============================================================
// Import: objetos → cambios parseados (FULL, sin diff todavía)
// ============================================================

export type FilaParseada = Required<CambioImport> & {
  sku_base: string
  nombre: string
}

export type ParseoOmitido = {
  sku_variante: string
  motivo: string
}

export type ResultadoParseo =
  | { ok: true; filas: FilaParseada[]; omitidos: ParseoOmitido[] }
  | { ok: false; errores: string[] }

/**
 * Parsea las filas crudas de XLSX.utils.sheet_to_json. Valida headers, valores
 * y duplicados (errores duros que bloquean todo). Detecta conflictos
 * product-level entre filas del mismo sku_base → esas filas se OMITEN (no
 * bloquean). Devuelve filas con TODOS los campos editables parseados (el diff
 * contra DB se hace en construirDiff).
 */
export function objetosAFilas(rows: Record<string, unknown>[]): ResultadoParseo {
  const errores: string[] = []

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, errores: ['El archivo está vacío'] }
  }

  const headers = Object.keys(rows[0] ?? {})
  const faltantes = COLUMNAS_EXPORT.filter((c) => !headers.includes(c))
  if (faltantes.length > 0) {
    return {
      ok: false,
      errores: [
        `Faltan columnas: ${faltantes.join(', ')}. El archivo debe tener el formato del export.`,
      ],
    }
  }

  type Crudo = {
    fila: number
    sku_base: string
    sku_variante: string
    nombre: string
    precio_neto: number
    categoria: string | null
    activo: boolean
    stock: number
    activa: boolean
    codigo_barras: string | null
  }

  const crudos: Crudo[] = []
  const skusVistos = new Set<string>()

  rows.forEach((row, idx) => {
    const numFila = idx + 2 // +2: fila 1 = header

    const sku = String(row.sku_variante ?? '').trim()
    if (sku === '') {
      errores.push(`Fila ${numFila}: sku_variante vacío`)
      return
    }
    if (skusVistos.has(sku)) {
      errores.push(`Fila ${numFila}: sku_variante "${sku}" duplicado`)
      return
    }
    skusVistos.add(sku)

    const precio = parseNumero(row.precio_neto)
    if (precio === null || precio <= 0) {
      errores.push(`Fila ${numFila} (${sku}): precio inválido`)
      return
    }
    const stock = parseEntero(row.stock)
    if (stock === null || stock < 0) {
      errores.push(`Fila ${numFila} (${sku}): stock inválido`)
      return
    }
    const activo = parseBool(row.activo_producto)
    if (activo === null) {
      errores.push(`Fila ${numFila} (${sku}): activo_producto debe ser Sí/No`)
      return
    }
    const activa = parseBool(row.activa_variante)
    if (activa === null) {
      errores.push(`Fila ${numFila} (${sku}): activa_variante debe ser Sí/No`)
      return
    }

    const categoriaRaw = String(row.categoria ?? '').trim()
    const codbarRaw = String(row.codigo_barras ?? '').trim()

    crudos.push({
      fila: numFila,
      sku_base: String(row.sku_base ?? '').trim(),
      sku_variante: sku,
      nombre: String(row.nombre ?? '').trim(),
      precio_neto: precio,
      categoria: categoriaRaw === '' ? null : categoriaRaw,
      activo,
      stock,
      activa,
      codigo_barras: codbarRaw === '' ? null : codbarRaw,
    })
  })

  if (errores.length > 0) {
    return { ok: false, errores }
  }

  // Conflictos product-level: agrupar por sku_base.
  const skusBaseEnConflicto = detectarConflictosProductLevel(crudos)
  const omitidos: ParseoOmitido[] = []
  const filas: FilaParseada[] = []

  for (const c of crudos) {
    if (skusBaseEnConflicto.has(c.sku_base)) {
      omitidos.push({
        sku_variante: c.sku_variante,
        motivo: 'Conflicto: filas del mismo producto con distinto precio/categoría/activo',
      })
      continue
    }
    filas.push({
      sku_variante: c.sku_variante,
      sku_base: c.sku_base,
      nombre: c.nombre,
      precio_neto: c.precio_neto,
      categoria: c.categoria,
      activo: c.activo,
      stock: c.stock,
      activa: c.activa,
      codigo_barras: c.codigo_barras,
    })
  }

  return { ok: true, filas, omitidos }
}

/**
 * Devuelve el set de sku_base cuyas filas (mismo producto) discrepan en algún
 * campo product-level (precio_neto, categoria, activo).
 */
export function detectarConflictosProductLevel(
  crudos: {
    sku_base: string
    precio_neto: number
    categoria: string | null
    activo: boolean
  }[]
): Set<string> {
  const porBase = new Map<string, typeof crudos>()
  for (const c of crudos) {
    const arr = porBase.get(c.sku_base) ?? []
    arr.push(c)
    porBase.set(c.sku_base, arr)
  }

  const conflicto = new Set<string>()
  for (const [skuBase, grupo] of porBase) {
    if (grupo.length < 2) continue
    const [primero] = grupo
    const discrepa = grupo.some(
      (g) =>
        g.precio_neto !== primero.precio_neto ||
        g.categoria !== primero.categoria ||
        g.activo !== primero.activo
    )
    if (discrepa) conflicto.add(skuBase)
  }
  // COLUMNAS_PRODUCTO referenciado para mantener la lista como fuente de verdad.
  void COLUMNAS_PRODUCTO
  return conflicto
}

// ============================================================
// Diff contra el estado actual de DB
// ============================================================

export type CeldaDiff = { actual: string; nuevo: string; cambio: boolean }
export type ColumnaDiff =
  | 'precio_neto'
  | 'categoria'
  | 'stock'
  | 'activo'
  | 'activa'
  | 'codigo_barras'

export type FilaDiff = {
  sku_variante: string
  nombre: string
  celdas: Partial<Record<ColumnaDiff, CeldaDiff>>
  omitido: boolean
  motivo?: string
}

export type ResultadoDiff = {
  filas: FilaDiff[]
  cambios: CambioImport[]
}

function txt(v: string | number | boolean | null): string {
  if (v === null) return '—'
  if (typeof v === 'boolean') return v ? SI : NO
  return String(v)
}

/**
 * Compara las filas parseadas contra el estado actual en DB y arma:
 *  - `filas`: para el preview (qué cambia por columna, qué se omite y por qué).
 *  - `cambios`: payload para la RPC, con SOLO los campos que efectivamente cambian.
 *
 * Omite: sku_variante no encontrado en DB; filas sin ningún cambio real.
 */
export function construirDiff(
  filas: FilaParseada[],
  actuales: EstadoActualImport[]
): ResultadoDiff {
  const porSku = new Map(actuales.map((a) => [a.sku_variante, a]))
  const resultFilas: FilaDiff[] = []
  const cambios: CambioImport[] = []

  for (const f of filas) {
    const actual = porSku.get(f.sku_variante)
    if (!actual) {
      resultFilas.push({
        sku_variante: f.sku_variante,
        nombre: f.nombre,
        celdas: {},
        omitido: true,
        motivo: 'SKU de variante no encontrado',
      })
      continue
    }

    const celdas: Partial<Record<ColumnaDiff, CeldaDiff>> = {}
    const cambio: CambioImport = { sku_variante: f.sku_variante }

    const comparar = <T extends string | number | boolean | null>(
      col: ColumnaDiff,
      actualVal: T,
      nuevoVal: T
    ) => {
      const cambioReal = actualVal !== nuevoVal
      celdas[col] = {
        actual: txt(actualVal),
        nuevo: txt(nuevoVal),
        cambio: cambioReal,
      }
      return cambioReal
    }

    if (comparar('precio_neto', actual.precio_neto, f.precio_neto)) {
      cambio.precio_neto = f.precio_neto
    }
    if (comparar('categoria', actual.categoria, f.categoria)) {
      cambio.categoria = f.categoria
    }
    if (comparar('stock', actual.stock, f.stock)) {
      cambio.stock = f.stock
    }
    if (comparar('activo', actual.activo, f.activo)) {
      cambio.activo = f.activo
    }
    if (comparar('activa', actual.activa, f.activa)) {
      cambio.activa = f.activa
    }
    if (comparar('codigo_barras', actual.codigo_barras, f.codigo_barras)) {
      cambio.codigo_barras = f.codigo_barras
    }

    const hayCambios = Object.keys(cambio).length > 1 // > 1 porque siempre está sku_variante
    if (!hayCambios) {
      resultFilas.push({
        sku_variante: f.sku_variante,
        nombre: f.nombre,
        celdas,
        omitido: true,
        motivo: 'Sin cambios',
      })
      continue
    }

    resultFilas.push({
      sku_variante: f.sku_variante,
      nombre: f.nombre,
      celdas,
      omitido: false,
    })
    cambios.push(cambio)
  }

  return { filas: resultFilas, cambios }
}
