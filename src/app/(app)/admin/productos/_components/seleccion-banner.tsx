'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  useSeleccionStore,
  useSeleccionCantidad,
  useEstadoPagina,
} from '../_state/seleccion-productos-store'
import { seleccionarTodosDelFiltro } from '../_actions/seleccionar-todos-filtro'
import type { ProductosFilters } from './productos-view'

const CAP = 1000

export function SeleccionBanner({
  paginaIds,
  total,
  filters,
}: {
  paginaIds: string[]
  total: number
  filters: ProductosFilters
}) {
  const estado = useEstadoPagina(paginaIds)
  const cantidad = useSeleccionCantidad()
  const agregarMuchos = useSeleccionStore((s) => s.agregarMuchos)
  const limpiar = useSeleccionStore((s) => s.limpiar)
  const [cargando, setCargando] = useState(false)

  // Se muestra solo si toda la pagina esta seleccionada Y hay mas en el filtro
  // Y aun no llegamos al cap.
  const mostrar = estado === 'todos' && total > cantidad && cantidad < CAP
  if (!mostrar) return null

  const aSeleccionar = Math.min(total, CAP)
  const texto =
    total > CAP
      ? `El filtro tiene ${total} productos. Se seleccionarán los primeros ${CAP} por el límite de operaciones masivas.`
      : `Seleccionaste ${cantidad} de esta página. Hay ${total} en el filtro completo.`

  async function seleccionarTodos() {
    setCargando(true)
    try {
      const res = await seleccionarTodosDelFiltro({
        busqueda: filters.q,
        soloActivos: filters.estado !== 'todos',
        stockBajo: filters.stock === 'bajo',
        marcaId: filters.marca || undefined,
        categoriaId: filters.categoria || undefined,
        categoriaAsignada:
          (filters.categoriaAsignada || undefined) as 'sin' | 'con' | undefined,
      })
      if (res.ok) agregarMuchos(res.ids)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <p className="text-muted-foreground">{texto}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={limpiar}>
          Cancelar
        </Button>
        <Button size="sm" onClick={seleccionarTodos} disabled={cargando}>
          {cargando ? 'Seleccionando…' : `Seleccionar ${aSeleccionar}`}
        </Button>
      </div>
    </div>
  )
}
