// src/app/(app)/admin/ventas/_components/exportar-ventas-button.tsx
'use client'

import { useState, useTransition } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { exportarVentasExcel } from '../_actions/exportar-ventas'

type ExportarVentasButtonProps = {
  ventasIds: string[]
  disabled?: boolean
}

/**
 * Exporta las ventas cuyos IDs se pasen por prop.
 * Esto permite que el export respete TODOS los filtros aplicados,
 * incluyendo la búsqueda live client-side y el filtro de cliente.
 */
export function ExportarVentasButton({
  ventasIds,
  disabled,
}: ExportarVentasButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState(false)

  const loading = isPending || downloading

  function handleExport() {
    if (ventasIds.length === 0) {
      toast.error('No hay ventas para exportar')
      return
    }

    startTransition(async () => {
      setDownloading(true)
      const toastId = toast.loading('Generando Excel...')

      try {
        const result = await exportarVentasExcel({ ids: ventasIds })

        if (!result.ok) {
          toast.error(result.error, { id: toastId })
          return
        }

        const byteChars = atob(result.dataBase64)
        const byteNumbers = new Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(
          `Excel descargado · ${ventasIds.length} ${ventasIds.length === 1 ? 'venta' : 'ventas'}`,
          { id: toastId }
        )
      } catch (err) {
        console.error('[ExportarVentasButton]', err)
        toast.error('Error al exportar', { id: toastId })
      } finally {
        setDownloading(false)
      }
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={loading || disabled || ventasIds.length === 0}
      className="h-8"
    >
      {loading ? (
        <>
          <Loader2 className="size-3.5 mr-2 animate-spin" />
          Generando...
        </>
      ) : (
        <>
          <Download className="size-3.5 mr-2" />
          Exportar Excel
          {ventasIds.length > 0 && (
            <span className="ml-1.5 text-muted-foreground font-numeric tabular-nums">
              ({ventasIds.length})
            </span>
          )}
        </>
      )}
    </Button>
  )
}