'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { exportarProductosAccion } from '../_actions/exportar-productos'
import { filasAObjetos, COLUMNAS_EXPORT } from '../_lib/excel-productos'
import type { ProductosFilters } from './productos-view'

export function ExportarBoton({ filters }: { filters: ProductosFilters }) {
  const [cargando, setCargando] = useState(false)

  async function exportar() {
    setCargando(true)
    try {
      const res = await exportarProductosAccion({
        busqueda: filters.q,
        soloActivos: filters.estado !== 'todos',
        stockBajo: filters.stock === 'bajo',
        marcaId: filters.marca || undefined,
        categoriaId: filters.categoria || undefined,
        categoriaAsignada:
          (filters.categoriaAsignada || undefined) as 'sin' | 'con' | undefined,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (res.filas.length === 0) {
        toast.warning('No hay productos para exportar con este filtro')
        return
      }
      if (res.filas.length > 1000) {
        toast.warning(
          `Tenés ${res.filas.length} filas. El import procesa máximo 1000 por archivo.`
        )
      }

      const objetos = filasAObjetos(res.filas)
      const aoa = [
        COLUMNAS_EXPORT as string[],
        ...objetos.map((o) => COLUMNAS_EXPORT.map((c) => o[c])),
      ]
      const ws = XLSX.utils.aoa_to_sheet(aoa)

      // Forzar codigo_barras como texto: Excel convertiría un código largo a
      // notación científica y perdería dígitos.
      const colCodBar = COLUMNAS_EXPORT.indexOf('codigo_barras')
      for (let r = 1; r <= objetos.length; r++) {
        const ref = XLSX.utils.encode_cell({ r, c: colCodBar })
        const cell = ws[ref]
        if (cell && cell.v !== '' && cell.v != null) {
          cell.t = 's'
          cell.v = String(cell.v)
        }
      }

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      const fecha = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `lemma-productos-${fecha}.xlsx`)
    } catch (err) {
      console.error('[ExportarBoton]', err)
      toast.error('No se pudo exportar')
    } finally {
      setCargando(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={exportar}
      disabled={cargando}
      className="gap-2"
    >
      {cargando ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      Exportar
    </Button>
  )
}
