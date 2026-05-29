'use client'

import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

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
import {
  FormCategoria,
  FormPrecioFijo,
  FormPrecioPct,
  FormStock,
  SIN_CATEGORIA,
} from './bulk-forms'
import type { BulkActualizarInput } from '../_actions/bulk-actualizar-productos'

type AccionAbierta =
  | 'activar'
  | 'desactivar'
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

export function BulkBarProductos({ categorias }: { categorias: string[] }) {
  const cantidad = useSeleccionCantidad()
  const limpiar = useSeleccionStore((s) => s.limpiar)
  const [accion, setAccion] = useState<AccionAbierta>(null)

  // ============ ESTADOS DE FORM (uno por acción) ============
  const [categoria, setCategoria] = useState<string>(SIN_CATEGORIA)
  const [precioFijo, setPrecioFijo] = useState<number | null>(null)
  const [pctDireccion, setPctDireccion] = useState<'subir' | 'bajar'>('subir')
  const [pctValor, setPctValor] = useState<number | null>(null)
  const [stockModo, setStockModo] = useState<'sumar' | 'restar' | 'fijar'>('sumar')
  const [stockValor, setStockValor] = useState<number | null>(null)
  const [stockMotivo, setStockMotivo] = useState<string>('')

  function resetForms() {
    setCategoria(SIN_CATEGORIA)
    setPrecioFijo(null)
    setPctDireccion('subir')
    setPctValor(null)
    setStockModo('sumar')
    setStockValor(null)
    setStockMotivo('')
  }

  if (cantidad === 0) return null

  /** Builder lazy del input: se ejecuta al confirmar. Snapshot de ids fresco
   *  + valores actuales del form. Devuelve null si los datos son inválidos
   *  (el dialog muestra un toast.error). */
  function buildInput(): BulkActualizarInput | null {
    if (!accion) return null
    const ids = Array.from(useSeleccionStore.getState().ids)
    if (ids.length === 0) return null

    switch (accion) {
      case 'activar':
        return { accion: 'cambiar_activo', ids, activo: true }
      case 'desactivar':
        return { accion: 'cambiar_activo', ids, activo: false }
      case 'cambiar_categoria':
        return {
          accion: 'cambiar_categoria',
          ids,
          categoria: categoria === SIN_CATEGORIA ? null : categoria,
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

  // ============ TEXTOS POR ACCIÓN ============
  function tituloDialog(): string {
    const n = cantidad
    const plural = n === 1 ? '' : 's'
    switch (accion) {
      case 'activar':
        return `¿Activar ${n} producto${plural}?`
      case 'desactivar':
        return `¿Desactivar ${n} producto${plural}?`
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

  function renderForm() {
    switch (accion) {
      case 'cambiar_categoria':
        return (
          <FormCategoria
            categorias={categorias}
            value={categoria}
            onChange={setCategoria}
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
              <DropdownMenuItem onClick={() => setAccion('activar')}>
                Activar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAccion('desactivar')}>
                Desactivar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAccion('cambiar_categoria')}>
                Cambiar categoría
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Cambiar precio</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setAccion('precio_pct')}>
                      Por porcentaje
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAccion('precio_fijo')}>
                      Fijar precio
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => setAccion('ajustar_stock')}>
                Ajustar stock
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <BulkAccionDialog
        open={accion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAccion(null)
            resetForms()
          }
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
    </>
  )
}
