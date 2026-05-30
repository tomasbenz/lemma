'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileSpreadsheet, X, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  objetosAFilas,
  construirDiff,
  type FilaDiff,
  type ParseoOmitido,
} from '../../_lib/excel-productos'
import type { CambioImport } from '../../_actions/importar-actualizar'
import {
  previewImportProductos,
  aplicarImportProductos,
} from '../../_actions/importar-actualizar'
import { BulkImportPreview } from './bulk-import-preview'

export function ImportarActualizarView() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [parseando, setParseando] = useState(false)
  const [errores, setErrores] = useState<string[]>([])
  const [filasDiff, setFilasDiff] = useState<FilaDiff[] | null>(null)
  const [cambios, setCambios] = useState<CambioImport[]>([])
  const [aplicando, setAplicando] = useState(false)

  const procesar = useCallback(async (file: File) => {
    setParseando(true)
    setArchivo(file)
    setErrores([])
    setFilasDiff(null)
    setCambios([])

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      })

      const parseo = objetosAFilas(rows)
      if (!parseo.ok) {
        setErrores(parseo.errores)
        toast.error(`${parseo.errores.length} error(es) en el archivo`)
        return
      }

      const skus = parseo.filas.map((f) => f.sku_variante)
      if (skus.length === 0) {
        setErrores(['No hay filas válidas para actualizar'])
        return
      }

      const prev = await previewImportProductos(skus)
      if (!prev.ok) {
        toast.error(prev.error)
        setArchivo(null)
        return
      }

      const { filas, cambios: cambiosDiff } = construirDiff(
        parseo.filas,
        prev.actuales
      )

      // Sumar las filas omitidas en el parse (conflictos product-level).
      const omitidasParse: FilaDiff[] = parseo.omitidos.map(
        (o: ParseoOmitido) => ({
          sku_variante: o.sku_variante,
          nombre: o.sku_variante,
          celdas: {},
          omitido: true,
          motivo: o.motivo,
        })
      )

      setFilasDiff([...filas, ...omitidasParse])
      setCambios(cambiosDiff)
    } catch (err) {
      console.error('[importar-actualizar] parse', err)
      toast.error('Error leyendo el archivo. ¿Es un .xlsx válido?')
      setArchivo(null)
    } finally {
      setParseando(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setArrastrando(false)
      const file = e.dataTransfer.files?.[0]
      if (file) procesar(file)
    },
    [procesar]
  )

  function reset() {
    setArchivo(null)
    setErrores([])
    setFilasDiff(null)
    setCambios([])
    if (inputRef.current) inputRef.current.value = ''
  }

  async function confirmar() {
    if (cambios.length === 0) return
    setAplicando(true)
    try {
      const res = await aplicarImportProductos(cambios)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        `${res.afectados} producto${res.afectados === 1 ? '' : 's'} actualizado${res.afectados === 1 ? '' : 's'}`,
        res.omitidos.length > 0
          ? {
              description: `${res.omitidos.length} omitido(s).`,
              action: res.operacionId
                ? {
                    label: 'Ver omitidos',
                    onClick: () =>
                      router.push(`/admin/operaciones/${res.operacionId}`),
                  }
                : undefined,
            }
          : undefined
      )
      reset()
      router.refresh()
    } finally {
      setAplicando(false)
    }
  }

  // ----- Errores de parseo -----
  if (errores.length > 0) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-destructive/10 text-destructive p-2">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <p className="font-medium">Hay errores en el archivo</p>
              <p className="text-sm text-muted-foreground">
                Corregilos y volvé a subirlo.
              </p>
            </div>
          </div>
          <div className="rounded-md border max-h-80 overflow-y-auto no-scrollbar p-2 space-y-1">
            {errores.map((e, i) => (
              <p key={i} className="text-xs font-mono">
                {e}
              </p>
            ))}
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button variant="outline" onClick={reset}>
              Volver a empezar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ----- Preview de diff -----
  if (filasDiff) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <FileSpreadsheet className="size-8 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{archivo?.name}</p>
              <p className="text-xs text-muted-foreground">
                Revisá los cambios antes de aplicar.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={reset}
              disabled={aplicando}
            >
              <X className="size-4" />
            </Button>
          </CardContent>
        </Card>

        <BulkImportPreview
          filas={filasDiff}
          cambiosCount={cambios.length}
          onConfirmar={confirmar}
          onCancelar={reset}
          loading={aplicando}
        />
      </div>
    )
  }

  // ----- Drop zone -----
  return (
    <Card>
      <CardContent className="pt-6">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setArrastrando(true)
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
            arrastrando
              ? 'border-foreground bg-muted'
              : 'border-border hover:border-foreground/40'
          )}
        >
          {parseando ? (
            <p className="text-sm text-muted-foreground">Procesando…</p>
          ) : (
            <>
              <Upload className="size-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium text-sm">
                Subí el Excel exportado (editado)
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Mismo formato del export. Solo actualiza productos existentes
                (máx. 1000 filas). <Check className="inline size-3" /> precio,
                categoría, stock, activo y código de barras.
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) procesar(file)
            }}
            className="hidden"
          />
        </div>
      </CardContent>
    </Card>
  )
}
