'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

type Columna = { key: string; label: string }

type Props = {
  columnas: Columna[]
  filas: Record<string, unknown>[]
  nombreArchivo: string
  nombreHoja?: string
  disabled?: boolean
}

/**
 * Botón genérico de exportación a .xlsx, 100% en cliente (sin server action).
 * Arma una hoja con header = labels y cada fila tomando los valores por `key`.
 * Descarga `${nombreArchivo}-AAAA-MM-DD.xlsx`.
 */
export function BotonExportarTabla({
  columnas,
  filas,
  nombreArchivo,
  nombreHoja = 'Datos',
  disabled = false,
}: Props) {
  const [cargando, setCargando] = useState(false)

  function exportar() {
    if (filas.length === 0) {
      toast.warning('No hay datos para exportar')
      return
    }
    setCargando(true)
    try {
      const header = columnas.map((c) => c.label)
      const cuerpo = filas.map((fila) =>
        columnas.map((c) => {
          const v = fila[c.key]
          // Normalizamos null/undefined a celda vacía; el resto va tal cual.
          return v === null || v === undefined ? '' : (v as XLSX.CellObject['v'])
        })
      )
      const aoa = [header, ...cuerpo]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, nombreHoja)
      const fecha = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `${nombreArchivo}-${fecha}.xlsx`)
    } catch (err) {
      console.error('[BotonExportarTabla]', err)
      toast.error('No se pudo exportar')
    } finally {
      setCargando(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={exportar}
      disabled={disabled || cargando}
      className="gap-1.5"
    >
      <Download className="size-3.5" />
      Exportar
    </Button>
  )
}
