'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { OpcionCatalogo } from '@/lib/queries/productos'
import {
  DEFAULT_REDONDEO,
  type EstrategiaRedondeo,
} from '@/lib/precios/redondeo'
import { AumentoMarcaSelect } from './aumento-marca-select'
import { AumentoRedondeoSelect } from './aumento-redondeo-select'
import {
  AumentoTablaCategorias,
  type FilaCategoria,
} from './aumento-tabla-categorias'
import { AumentoPreviewDialog } from './aumento-preview-dialog'
import {
  previewAumento,
  type PreviewAumentoResultado,
} from '../_actions/preview-aumento'
import { aplicarAumento } from '../_actions/aplicar-aumento'

export type ConteoCategoria = {
  categoria_id: string
  total: number
  suma: number
  porMarca: Record<string, { n: number; suma: number }>
}

type PreviewOk = Extract<PreviewAumentoResultado, { ok: true }>

export function AumentoView({
  marcas,
  categorias,
  conteos,
}: {
  marcas: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
  conteos: ConteoCategoria[]
}) {
  const router = useRouter()

  const [marcaId, setMarcaId] = React.useState<string | null>(null)
  const [redondeo, setRedondeo] =
    React.useState<EstrategiaRedondeo>(DEFAULT_REDONDEO)
  const [pcts, setPcts] = React.useState<Record<string, number | null>>({})

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<PreviewOk | null>(null)
  const [motivo, setMotivo] = React.useState('')
  const [aplicando, setAplicando] = React.useState(false)

  const conteoPorCat = React.useMemo(
    () => new Map(conteos.map((c) => [c.categoria_id, c])),
    [conteos]
  )

  // Filas de la tabla, scopeadas por la marca elegida. Solo categorías con
  // productos en ese scope.
  const filas = React.useMemo<FilaCategoria[]>(() => {
    const out: FilaCategoria[] = []
    for (const cat of categorias) {
      const c = conteoPorCat.get(cat.id)
      if (!c) continue
      const stats =
        marcaId === null
          ? { n: c.total, suma: c.suma }
          : c.porMarca[marcaId] ?? { n: 0, suma: 0 }
      if (stats.n === 0) continue
      out.push({
        categoria_id: cat.id,
        nombre: cat.nombre,
        n: stats.n,
        promActual: stats.n > 0 ? stats.suma / stats.n : 0,
      })
    }
    return out
  }, [categorias, conteoPorCat, marcaId])

  const ajustes = React.useMemo(
    () =>
      Object.entries(pcts)
        .filter(([, v]) => v !== null && v !== 0)
        .map(([categoria_id, v]) => ({ categoria_id, pct: v as number })),
    [pcts]
  )

  function setPct(categoriaId: string, value: number | null) {
    setPcts((prev) => ({ ...prev, [categoriaId]: value }))
  }

  function limpiar() {
    setPcts({})
    setMotivo('')
  }

  async function abrirPreview() {
    if (ajustes.length === 0) {
      toast.error('Cargá al menos un porcentaje distinto de 0')
      return
    }
    setDialogOpen(true)
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    const res = await previewAumento({ marca_id: marcaId, ajustes, redondeo })
    setPreviewLoading(false)
    if (!res.ok) {
      setPreviewError(res.error)
      return
    }
    if (res.total_afectados === 0) {
      setPreviewError('Ningún producto coincide con los ajustes cargados.')
      return
    }
    setPreview(res)
  }

  async function aplicar() {
    setAplicando(true)
    const res = await aplicarAumento({
      marca_id: marcaId,
      ajustes,
      redondeo,
      motivo,
    })
    setAplicando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `Aumento aplicado a ${res.afectados} ${res.afectados === 1 ? 'producto' : 'productos'}.`
    )
    setDialogOpen(false)
    limpiar()
    // Recargar conteos/promedios desde el server.
    router.refresh()
  }

  const totalConPct = ajustes.length

  return (
    <div className="space-y-4">
      {/* Barra de controles */}
      <div className="flex flex-wrap items-end gap-3">
        <AumentoMarcaSelect marcas={marcas} value={marcaId} onChange={setMarcaId} />
        <AumentoRedondeoSelect value={redondeo} onChange={setRedondeo} />
        {totalConPct > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={limpiar}
          >
            Limpiar
          </Button>
        )}
      </div>

      {filas.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No hay categorías con productos para la marca seleccionada.
        </div>
      ) : (
        <>
          <AumentoTablaCategorias
            filas={filas}
            pcts={pcts}
            redondeo={redondeo}
            onPctChange={setPct}
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {totalConPct > 0
                ? `${totalConPct} ${totalConPct === 1 ? 'categoría' : 'categorías'} con cambios.`
                : 'Cargá un porcentaje en las categorías que quieras aumentar.'}
            </p>
            <Button onClick={abrirPreview} disabled={totalConPct === 0}>
              <Sparkles className="size-4 mr-2" />
              Previsualizar
            </Button>
          </div>
        </>
      )}

      <AumentoPreviewDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!aplicando) setDialogOpen(v)
        }}
        loading={previewLoading}
        error={previewError}
        preview={preview}
        redondeo={redondeo}
        motivo={motivo}
        onMotivoChange={setMotivo}
        onAplicar={aplicar}
        aplicando={aplicando}
      />
    </div>
  )
}
