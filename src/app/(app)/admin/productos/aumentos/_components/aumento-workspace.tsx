'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import type { OpcionCatalogo } from '@/lib/queries/productos'
import { redondearPrecio, DEFAULT_REDONDEO } from '@/lib/precios/redondeo'
import { AumentoFiltrosBar } from './aumento-filtros'
import { AumentoTabla } from './aumento-tabla'
import { AumentoBulkBar, type AccionAumento } from './aumento-bulk-bar'
import {
  AumentoPreviewDialog,
  type PreviewRow,
} from './aumento-preview-dialog'
import {
  buscarProductos,
  idsDelFiltro,
  productosParaPreview,
  type AumentoFiltros,
  type SortAumento,
  type ProductoEnAumento,
} from '../_actions/buscar-productos'
import { aplicarAumentoWorkspace } from '../_actions/aplicar-aumento-workspace'

const PAGE_SIZE = 50

const FILTROS_INICIALES: AumentoFiltros = {
  marca_id: null,
  categoria_id: null,
  q: null,
  solo_activos: true,
}

function tieneFiltroPrincipal(f: AumentoFiltros): boolean {
  return f.marca_id !== null || f.categoria_id !== null
}

function calcularPrecioNuevo(accion: AccionAumento, precioActual: number): number {
  switch (accion.tipo) {
    case 'subir':
      return redondearPrecio(precioActual * (1 + accion.valor / 100), accion.redondeo)
    case 'bajar':
      return redondearPrecio(precioActual * (1 - accion.valor / 100), accion.redondeo)
    case 'fijar':
      return redondearPrecio(accion.valor, accion.redondeo)
  }
}

export function AumentoWorkspace({
  marcas,
  categorias,
}: {
  marcas: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
}) {
  const router = useRouter()

  const [filtros, setFiltros] = React.useState<AumentoFiltros>(FILTROS_INICIALES)
  const [sort, setSort] = React.useState<SortAumento>('nombre')
  const [page, setPage] = React.useState(1)

  const [qDebounced, setQDebounced] = React.useState<string | null>(null)

  const [productos, setProductos] = React.useState<ProductoEnAumento[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalFiltroCompleto, setTotalFiltroCompleto] = React.useState(0)
  const [cargando, setCargando] = React.useState(false)

  const [seleccionados, setSeleccionados] = React.useState<Set<string>>(new Set())
  const [seleccionExcedeCap, setSeleccionExcedeCap] = React.useState(false)

  // Preview dialog
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [rows, setRows] = React.useState<PreviewRow[]>([])
  const [accionActual, setAccionActual] = React.useState<AccionAumento | null>(null)
  const [motivo, setMotivo] = React.useState('')
  const [aplicando, setAplicando] = React.useState(false)

  const hayFiltro = tieneFiltroPrincipal(filtros)
  const reqId = React.useRef(0)

  // Debounce de la búsqueda por texto (300ms).
  React.useEffect(() => {
    const t = setTimeout(() => setQDebounced(filtros.q), 300)
    return () => clearTimeout(t)
  }, [filtros.q])

  // Fetch al cambiar filtros principales / búsqueda / sort / página.
  React.useEffect(() => {
    if (!hayFiltro) {
      setProductos([])
      setTotal(0)
      setTotalFiltroCompleto(0)
      return
    }
    const id = ++reqId.current
    setCargando(true)
    buscarProductos({
      marca_id: filtros.marca_id,
      categoria_id: filtros.categoria_id,
      q: qDebounced,
      solo_activos: filtros.solo_activos,
      page,
      page_size: PAGE_SIZE,
      sort,
    })
      .then((res) => {
        if (id !== reqId.current) return // respuesta vieja
        setProductos(res.productos)
        setTotal(res.total)
        setTotalFiltroCompleto(res.total_filtro_completo)
      })
      .finally(() => {
        if (id === reqId.current) setCargando(false)
      })
  }, [
    hayFiltro,
    filtros.marca_id,
    filtros.categoria_id,
    filtros.solo_activos,
    qDebounced,
    sort,
    page,
  ])

  // ===== Handlers de filtros =====
  function onFiltrosChange(patch: Partial<AumentoFiltros>) {
    setFiltros((prev) => ({ ...prev, ...patch }))
    setPage(1)
    // El set de productos cambia → limpiar selección.
    setSeleccionados(new Set())
    setSeleccionExcedeCap(false)
  }

  function onSortChange(s: SortAumento) {
    setSort(s)
    setPage(1)
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_INICIALES)
    setQDebounced(null)
    setSort('nombre')
    setPage(1)
    setSeleccionados(new Set())
    setSeleccionExcedeCap(false)
  }

  // ===== Selección =====
  function toggle(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSeleccionExcedeCap(false)
  }

  function togglePagina(ids: string[], seleccionar: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (seleccionar) next.add(id)
        else next.delete(id)
      }
      return next
    })
    setSeleccionExcedeCap(false)
  }

  async function seleccionarTodoFiltro() {
    const res = await idsDelFiltro({
      marca_id: filtros.marca_id,
      categoria_id: filtros.categoria_id,
      q: qDebounced,
      solo_activos: filtros.solo_activos,
    })
    setSeleccionados(new Set(res.ids))
    setSeleccionExcedeCap(res.excede_cap)
    if (res.excede_cap) {
      toast.warning('El filtro supera 1000 productos. Se seleccionaron los primeros 1000.')
    }
  }

  function limpiarSeleccion() {
    setSeleccionados(new Set())
    setSeleccionExcedeCap(false)
  }

  // ===== Preview =====
  async function abrirPreview(accion: AccionAumento) {
    const ids = [...seleccionados]
    if (ids.length === 0) return
    setAccionActual(accion)
    setPreviewOpen(true)
    setPreviewLoading(true)
    setRows([])
    const datos = await productosParaPreview(ids)
    const nuevasRows: PreviewRow[] = datos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      marca_nombre: p.marca_nombre,
      precio_actual: p.precio_neto,
      precio_nuevo: calcularPrecioNuevo(accion, p.precio_neto),
    }))
    // Orden estable por nombre.
    nuevasRows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    setRows(nuevasRows)
    setPreviewLoading(false)
  }

  function quitarRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  async function aplicar() {
    const cambios = rows.map((r) => ({ id: r.id, precio_nuevo: r.precio_nuevo }))
    setAplicando(true)
    const res = await aplicarAumentoWorkspace({ cambios, motivo })
    setAplicando(false)
    if (!res.ok) {
      toast.error(res.error ?? 'No se pudo aplicar')
      return
    }
    toast.success(
      `Precios actualizados en ${res.afectados} ${res.afectados === 1 ? 'producto' : 'productos'}.`
    )
    setPreviewOpen(false)
    setMotivo('')
    setRows([])
    limpiarSeleccion()
    // Re-fetch para ver los precios nuevos.
    const id = ++reqId.current
    setCargando(true)
    buscarProductos({
      marca_id: filtros.marca_id,
      categoria_id: filtros.categoria_id,
      q: qDebounced,
      solo_activos: filtros.solo_activos,
      page,
      page_size: PAGE_SIZE,
      sort,
    })
      .then((r) => {
        if (id !== reqId.current) return
        setProductos(r.productos)
        setTotal(r.total)
        setTotalFiltroCompleto(r.total_filtro_completo)
      })
      .finally(() => {
        if (id === reqId.current) setCargando(false)
      })
    router.refresh()
  }

  const hayFiltrosActivos =
    filtros.marca_id !== null ||
    filtros.categoria_id !== null ||
    (filtros.q !== null && filtros.q !== '') ||
    !filtros.solo_activos ||
    sort !== 'nombre'

  return (
    <div className="space-y-4 pb-24">
      <AumentoFiltrosBar
        marcas={marcas}
        categorias={categorias}
        filtros={filtros}
        sort={sort}
        onFiltrosChange={onFiltrosChange}
        onSortChange={onSortChange}
        onLimpiar={limpiarFiltros}
        hayFiltros={hayFiltrosActivos}
      />

      <AumentoTabla
        productos={productos}
        total={total}
        totalFiltroCompleto={totalFiltroCompleto}
        seleccionados={seleccionados}
        onToggle={toggle}
        onTogglePagina={togglePagina}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        cargando={cargando}
        hayFiltroPrincipal={hayFiltro}
        onSeleccionarTodoFiltro={seleccionarTodoFiltro}
        seleccionExcedeCap={seleccionExcedeCap}
      />

      {seleccionados.size > 0 && (
        <AumentoBulkBar
          cantidad={seleccionados.size}
          onLimpiar={limpiarSeleccion}
          onRevisar={abrirPreview}
          disabled={previewOpen}
        />
      )}

      <AumentoPreviewDialog
        open={previewOpen}
        onOpenChange={(v) => {
          if (!aplicando) setPreviewOpen(v)
        }}
        loading={previewLoading}
        rows={rows}
        onQuitar={quitarRow}
        motivo={motivo}
        onMotivoChange={setMotivo}
        onAplicar={aplicar}
        aplicando={aplicando}
        accion={accionActual?.tipo ?? 'subir'}
        valor={accionActual?.valor ?? 0}
        redondeo={accionActual?.redondeo ?? DEFAULT_REDONDEO}
      />
    </div>
  )
}
