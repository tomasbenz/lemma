'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useSeleccionStore,
  useSeleccionCantidad,
} from '../_state/seleccion-productos-store'
import { BulkAccionDialog } from './bulk-accion-dialog'
import { BulkReglaDialog } from './bulk-regla-dialog'
import { BulkPreviewDialog } from './bulk-preview-dialog'
import {
  FormCatalogoSelect,
  FormPrecioFijo,
  FormPrecioPct,
  FormStock,
  SIN_SELECCION,
} from './bulk-forms'
import type { OpcionCatalogo } from '@/lib/queries/productos'
import {
  calcularPreviewPrecioPct,
  calcularPreviewStock,
  type FilaPreview,
} from '../_lib/calcular-preview'
import type { BulkActualizarInput } from '../_actions/bulk-actualizar-productos'
import {
  bulkActualizarProductosIndividual,
  obtenerPreviewProductos,
} from '../_actions/bulk-actualizar-individual'

type AccionAbierta =
  | 'activar'
  | 'desactivar'
  | 'cambiar_marca'
  | 'cambiar_categoria'
  | 'precio_pct'
  | 'precio_fijo'
  | 'ajustar_stock'
  | null

/** Exhaustividad en compile-time: si agregamos una acción y no la cubrimos en
 *  el switch de buildInput, tsc rompe acá. */
function assertNever(x: never): never {
  throw new Error(`Acción no manejada: ${String(x)}`)
}

export function BulkBarProductos({
  marcas,
  categorias,
}: {
  marcas: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
}) {
  const cantidad = useSeleccionCantidad()
  const limpiar = useSeleccionStore((s) => s.limpiar)
  const router = useRouter()
  const [accion, setAccion] = useState<AccionAbierta>(null)

  // Fase 2 (precio_pct / ajustar_stock): regla -> preview editable -> aplicar.
  const [etapa, setEtapa] = useState<'regla' | 'preview'>('regla')
  const [previewFilas, setPreviewFilas] = useState<FilaPreview[] | null>(null)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [aplicando, setAplicando] = useState(false)

  // ============ ESTADOS DE FORM (uno por acción) ============
  const [marcaId, setMarcaId] = useState<string>(SIN_SELECCION)
  const [categoriaId, setCategoriaId] = useState<string>(SIN_SELECCION)
  const [precioFijo, setPrecioFijo] = useState<number | null>(null)
  const [pctDireccion, setPctDireccion] = useState<'subir' | 'bajar'>('subir')
  const [pctValor, setPctValor] = useState<number | null>(null)
  const [stockModo, setStockModo] = useState<'sumar' | 'restar' | 'fijar'>('sumar')
  const [stockValor, setStockValor] = useState<number | null>(null)
  const [stockMotivo, setStockMotivo] = useState<string>('')

  function resetForms() {
    setMarcaId(SIN_SELECCION)
    setCategoriaId(SIN_SELECCION)
    setPrecioFijo(null)
    setPctDireccion('subir')
    setPctValor(null)
    setStockModo('sumar')
    setStockValor(null)
    setStockMotivo('')
  }

  function cerrarTodo() {
    setAccion(null)
    setEtapa('regla')
    setPreviewFilas(null)
    resetForms()
  }

  function abrirAccion(a: Exclude<AccionAbierta, null>) {
    setAccion(a)
    setEtapa('regla')
    setPreviewFilas(null)
  }

  if (cantidad === 0) return null

  const esFase2 = accion === 'precio_pct' || accion === 'ajustar_stock'

  // ============ FASE 1: input directo para BulkAccionDialog ============
  /** Builder lazy del input. Solo se invoca para acciones Fase 1 (BulkAccionDialog
   *  no se monta para las Fase 2). Snapshot fresco de ids al confirmar. */
  function buildInput(): BulkActualizarInput | null {
    if (!accion) return null
    const ids = Array.from(useSeleccionStore.getState().ids)
    if (ids.length === 0) return null

    switch (accion) {
      case 'activar':
        return { accion: 'cambiar_activo', ids, activo: true }
      case 'desactivar':
        return { accion: 'cambiar_activo', ids, activo: false }
      case 'cambiar_marca': {
        const id = marcaId === SIN_SELECCION ? null : marcaId
        return {
          accion: 'cambiar_marca',
          ids,
          marcaId: id,
          marcaNombre: id ? marcas.find((m) => m.id === id)?.nombre ?? null : null,
        }
      }
      case 'cambiar_categoria': {
        const id = categoriaId === SIN_SELECCION ? null : categoriaId
        return {
          accion: 'cambiar_categoria',
          ids,
          categoriaId: id,
          categoriaNombre: id
            ? categorias.find((c) => c.id === id)?.nombre ?? null
            : null,
        }
      }
      case 'precio_fijo':
        if (precioFijo === null || precioFijo <= 0) return null
        return { accion: 'precio_fijo', ids, precio: precioFijo }
      case 'precio_pct': {
        if (pctValor === null || pctValor <= 0) return null
        const pct = pctDireccion === 'bajar' ? -pctValor : pctValor
        if (pct < -100) return null
        return { accion: 'precio_pct', ids, pct }
      }
      case 'ajustar_stock': {
        if (stockValor === null) return null
        if (stockModo === 'fijar' ? stockValor < 0 : stockValor <= 0) return null
        if (stockMotivo.trim().length < 3) return null
        const accionAPI =
          stockModo === 'sumar'
            ? 'stock_sumar'
            : stockModo === 'restar'
              ? 'stock_restar'
              : 'stock_fijar'
        return {
          accion: accionAPI,
          ids,
          valor: stockValor,
          motivo: stockMotivo.trim(),
        }
      }
      default:
        return assertNever(accion)
    }
  }

  // ============ FASE 2: cálculo del pct y validez de la regla ============
  const pctFinal = pctDireccion === 'bajar' ? -(pctValor ?? 0) : (pctValor ?? 0)

  function reglaFase2Invalida(): boolean {
    if (accion === 'precio_pct') {
      return pctValor === null || pctValor <= 0 || pctFinal < -100
    }
    if (accion === 'ajustar_stock') {
      if (stockValor === null) return true
      if (stockModo === 'fijar' ? stockValor < 0 : stockValor <= 0) return true
      if (stockMotivo.trim().length < 3) return true
      return false
    }
    return true
  }

  /** Paso "Revisar cambios": trae datos frescos y arma las filas de la preview. */
  async function revisarCambios() {
    const ids = Array.from(useSeleccionStore.getState().ids)
    if (ids.length === 0) return
    setCargandoPreview(true)
    try {
      const res = await obtenerPreviewProductos(ids)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const filas =
        accion === 'precio_pct'
          ? calcularPreviewPrecioPct(res.productos, pctFinal)
          : calcularPreviewStock(res.productos, stockModo, stockValor ?? 0)
      setPreviewFilas(filas)
      setEtapa('preview')
    } catch {
      toast.error('No se pudo armar la vista previa')
    } finally {
      setCargandoPreview(false)
    }
  }

  /** Confirmar en la preview: arma los cambios finales (override manual o
   *  propuesto), llama la RPC individual y muestra el resumen. */
  async function aplicarPreview(overrides: Map<string, number>) {
    if (!previewFilas) return
    const aplicables = previewFilas.filter((f) => !f.omitido)
    if (aplicables.length === 0) return

    setAplicando(true)
    try {
      const res =
        accion === 'precio_pct'
          ? await bulkActualizarProductosIndividual({
              accion: 'precio_individual',
              cambios: aplicables.map((f) => ({
                id: f.id,
                precio: overrides.get(f.id) ?? f.propuesto,
              })),
            })
          : await bulkActualizarProductosIndividual({
              accion: 'stock_individual',
              motivo: stockMotivo.trim(),
              cambios: aplicables.map((f) => ({
                id: f.id,
                stock: overrides.get(f.id) ?? f.propuesto,
              })),
            })

      if (!res.ok) {
        toast.error(res.error)
        return
      }

      toast.success(
        `${res.afectados} producto${res.afectados === 1 ? '' : 's'} actualizado${res.afectados === 1 ? '' : 's'}`,
        res.omitidos.length > 0
          ? {
              description: `${res.omitidos.length} omitido${res.omitidos.length === 1 ? '' : 's'} (no aplicaba la acción).`,
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
      cerrarTodo()
      limpiar()
    } finally {
      setAplicando(false)
    }
  }

  // ============ TEXTOS ============
  const n = cantidad
  const plural = n === 1 ? '' : 's'

  function tituloDialog(): string {
    switch (accion) {
      case 'activar':
        return `¿Activar ${n} producto${plural}?`
      case 'desactivar':
        return `¿Desactivar ${n} producto${plural}?`
      case 'cambiar_marca':
        return `Cambiar marca de ${n} producto${plural}`
      case 'cambiar_categoria':
        return `Cambiar categoría de ${n} producto${plural}`
      case 'precio_fijo':
        return `Fijar precio de ${n} producto${plural}`
      case 'precio_pct':
        return `Ajustar precio de ${n} producto${plural}`
      case 'ajustar_stock':
        return `Ajustar stock de ${n} producto${plural}`
      case null:
        return ''
      default:
        return assertNever(accion)
    }
  }

  function descripcionDialog(): string | undefined {
    switch (accion) {
      case 'activar':
        return 'Los productos vuelven a estar disponibles en la caja.'
      case 'desactivar':
        return 'Los productos dejan de aparecer en la caja. Podés volver a activarlos cuando quieras.'
      default:
        return undefined
    }
  }

  function confirmLabel(): string {
    switch (accion) {
      case 'activar':
        return 'Activar'
      case 'desactivar':
        return 'Desactivar'
      default:
        return 'Aplicar'
    }
  }

  function subtituloPreview(): string {
    if (accion === 'precio_pct') {
      return `Los precios ${pctDireccion === 'subir' ? 'suben' : 'bajan'} un ${pctValor ?? 0}%. Podés ajustar fila por fila.`
    }
    const modoTxt =
      stockModo === 'sumar'
        ? `Sumar ${stockValor ?? 0}`
        : stockModo === 'restar'
          ? `Restar ${stockValor ?? 0}`
          : `Fijar en ${stockValor ?? 0}`
    return `${modoTxt}. Podés ajustar fila por fila.`
  }

  function renderForm() {
    switch (accion) {
      case 'cambiar_marca':
        return (
          <FormCatalogoSelect
            label="Nueva marca"
            sinLabel="Sin marca"
            placeholder="Elegí una marca"
            opciones={marcas}
            value={marcaId}
            onChange={setMarcaId}
          />
        )
      case 'cambiar_categoria':
        return (
          <FormCatalogoSelect
            label="Nueva categoría"
            sinLabel="Sin categoría"
            placeholder="Elegí una categoría"
            opciones={categorias}
            value={categoriaId}
            onChange={setCategoriaId}
          />
        )
      case 'precio_fijo':
        return <FormPrecioFijo value={precioFijo} onChange={setPrecioFijo} />
      case 'precio_pct':
        return (
          <FormPrecioPct
            direccion={pctDireccion}
            onDireccionChange={setPctDireccion}
            valor={pctValor}
            onValorChange={setPctValor}
          />
        )
      case 'ajustar_stock':
        return (
          <FormStock
            modo={stockModo}
            onModoChange={setStockModo}
            valor={stockValor}
            onValorChange={setStockValor}
            motivo={stockMotivo}
            onMotivoChange={setStockMotivo}
          />
        )
      default:
        return null
    }
  }

  return (
    <>
      <div
        role="region"
        aria-label="Acciones masivas"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-elev-3 enter-up"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={limpiar}
          aria-label="Limpiar selección"
        >
          <X className="size-3.5" />
        </Button>
        <span className="text-sm font-medium">
          <span className="font-numeric tabular-nums">{cantidad}</span>{' '}
          {cantidad === 1 ? 'seleccionado' : 'seleccionados'}
        </span>

        <div className="border-l pl-2 ml-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Acciones
                <ChevronDown className="size-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuItem onClick={() => abrirAccion('activar')}>
                Activar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => abrirAccion('desactivar')}>
                Desactivar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => abrirAccion('cambiar_marca')}>
                Cambiar marca
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => abrirAccion('cambiar_categoria')}>
                Cambiar categoría
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Cambiar precio</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => abrirAccion('precio_pct')}>
                      Por porcentaje
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => abrirAccion('precio_fijo')}>
                      Fijar precio
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => abrirAccion('ajustar_stock')}>
                Ajustar stock
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* FASE 1: confirmación directa (activar/desactivar/categoría/precio fijo) */}
      <BulkAccionDialog
        open={accion !== null && !esFase2}
        onOpenChange={(open) => {
          if (!open) cerrarTodo()
        }}
        buildInput={buildInput}
        titulo={tituloDialog()}
        descripcion={descripcionDialog()}
        confirmLabel={confirmLabel()}
        destructive={accion === 'desactivar'}
        onSuccess={limpiar}
      >
        {renderForm()}
      </BulkAccionDialog>

      {/* FASE 2 — paso regla base (precio_pct / ajustar_stock) */}
      <BulkReglaDialog
        open={esFase2 && etapa === 'regla'}
        onOpenChange={(open) => {
          if (!open) cerrarTodo()
        }}
        titulo={tituloDialog()}
        confirmLabel="Revisar cambios"
        onConfirm={revisarCambios}
        loading={cargandoPreview}
        confirmDisabled={reglaFase2Invalida()}
      >
        {renderForm()}
      </BulkReglaDialog>

      {/* FASE 2 — preview editable */}
      {previewFilas && (
        <BulkPreviewDialog
          open={esFase2 && etapa === 'preview'}
          onOpenChange={(open) => {
            // Volver / ESC / X → vuelve al paso de regla (sin perder los datos).
            if (!open) setEtapa('regla')
          }}
          titulo={tituloDialog()}
          subtitulo={subtituloPreview()}
          filas={previewFilas}
          tipoValor={accion === 'ajustar_stock' ? 'stock' : 'precio'}
          onConfirmar={aplicarPreview}
          loading={aplicando}
        />
      )}
    </>
  )
}
