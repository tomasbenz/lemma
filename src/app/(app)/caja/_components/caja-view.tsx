// src/app/(app)/caja/_components/caja-view.tsx
'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Search, Package, ShoppingCart, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatARS } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import { cn } from '@/lib/utils'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import type { ProductoCaja, VarianteCaja } from '@/lib/queries/productos-caja'
import { rankear } from '@/lib/search/fuzzy'
import type { CurrentUser } from '@/lib/auth/get-current-user'
import type { TurnoActivo } from '@/lib/queries/turnos'
import {
  pareceCodigoBarras,
  normalizarCodigoBarras,
} from '@/lib/codigo-barras/validar'
import { useCarrito } from '../_hooks/use-carrito'
import { useCatalogData } from '../_hooks/use-catalog-data'
import { useScannerBeep } from '../_hooks/use-scanner-beep'
import { CarritoPanel } from './carrito-panel'
import { SelectorVariantes } from './selector-variantes'
import { ModalCobro } from './modal-cobro'
import { ModalGuardarPedido } from './modal-guardar-pedido'
import { BannerTurno } from './banner-turno'

type CajaViewProps = {
  user: CurrentUser
  recargoManualHabilitado: boolean
  recargo105Habilitado: boolean
  turnoActivo: TurnoActivo
}

export function CajaView({
  user,
  recargoManualHabilitado,
  recargo105Habilitado,
  turnoActivo,
}: CajaViewProps) {
  const catalog = useCatalogData()

  // Loader SOLO en la primerísima entrada sin cache (raro, primera vez post-login).
  // Si hay IndexedDB cacheado, useCatalogData ya hidrata sincrónicamente y
  // saltea este estado.
  if (catalog.status === 'loading') {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14))]">
        {/* Render esquelético sin spinner: parece la app, no un loader */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className="border-b bg-background p-4">
            <div className="h-11 w-full rounded-md bg-muted animate-pulse" />
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24 lg:pb-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] rounded-lg bg-muted/40 animate-pulse"
                />
              ))}
            </div>
          </div>
        </div>
        <aside className="hidden lg:block w-[380px] shrink-0 border-l" />
      </div>
    )
  }

  // Estado vacío: no hay cache local y no se pudo contactar al server
  if (catalog.status === 'empty') {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14))] items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <WifiOff className="size-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold">Catálogo no disponible</h2>
          <p className="text-sm text-muted-foreground">{catalog.message}</p>
        </div>
      </div>
    )
  }

  // catalog.status === 'ready'
  // catalog.status === 'ready'
  // Solo marcamos "offline source" si el server fetch ya terminó y falló.
  // Mientras está en background no mostramos banner para evitar falsos positivos
  // durante la hidratación inicial desde IndexedDB.
  return (
    <CajaViewInner
      productos={catalog.data.productos}
      clientes={catalog.data.clientes}
      user={user}
      recargoManualHabilitado={recargoManualHabilitado}
      recargo105Habilitado={recargo105Habilitado}
      turnoActivo={turnoActivo}
      isOfflineSource={
        catalog.source === 'local' && catalog.serverFetchSettled
      }
    />
  )
}

/**
 * El render real de la caja, con todos los datos cargados.
 * Se renderiza recién cuando catalog.status === 'ready' para evitar tener
 * que manejar productos/clientes posiblemente undefined en todo el árbol.
 */
function CajaViewInner({
  productos,
  clientes,
  user,
  recargoManualHabilitado,
  recargo105Habilitado,
  turnoActivo,
  isOfflineSource,
}: {
  productos: ProductoCaja[]
  clientes: import('@/lib/queries/clientes-caja').ClienteCaja[]
  user: CurrentUser
  recargoManualHabilitado: boolean
  recargo105Habilitado: boolean
  turnoActivo: TurnoActivo
  isOfflineSource: boolean
}) {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [productoSelector, setProductoSelector] = useState<ProductoCaja | null>(
    null
  )
  const [modalCobroOpen, setModalCobroOpen] = useState(false)
  const [modalGuardarOpen, setModalGuardarOpen] = useState(false)
  const [confirmarLimpiarOpen, setConfirmarLimpiarOpen] = useState(false)
  // Drawer del carrito en tablet/mobile (en desktop el carrito es panel lateral fijo)
  const [carritoSheetOpen, setCarritoSheetOpen] = useState(false)
  const carrito = useCarrito()
  const busquedaInputRef = useRef<HTMLInputElement>(null)
  const { beepExito, beepError } = useScannerBeep()

  const puedeCobrarDirecto = user.rol === 'admin' || user.rol === 'superadmin'

  useEffect(() => {
    if (!puedeCobrarDirecto && carrito.descuentoValor > 0) {
      carrito.setDescuentoValor(0)
    }
    // setDescuentoValor está envuelto en useCallback (estable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeCobrarDirecto, carrito.descuentoValor])

  const hayModalAbierto =
    productoSelector !== null ||
    modalCobroOpen ||
    modalGuardarOpen ||
    confirmarLimpiarOpen ||
    carritoSheetOpen

  useKeyboardShortcut(
    '/',
    () => {
      busquedaInputRef.current?.focus()
      busquedaInputRef.current?.select()
    },
    { ignoreInInputs: true, preventDefault: true, enabled: !hayModalAbierto }
  )

  useKeyboardShortcut(
    'F2',
    () => {
      if (carrito.items.length === 0) {
        toast.error('El carrito está vacío')
        return
      }
      setModalGuardarOpen(true)
    },
    { ignoreInInputs: false, preventDefault: true, enabled: !hayModalAbierto }
  )

  useKeyboardShortcut(
    'F5',
    () => {
      if (!puedeCobrarDirecto) return
      if (carrito.items.length === 0) {
        toast.error('El carrito está vacío')
        return
      }
      setModalCobroOpen(true)
    },
    {
      ignoreInInputs: false,
      preventDefault: true,
      enabled: !hayModalAbierto && puedeCobrarDirecto,
    }
  )

  useKeyboardShortcut(
    'F9',
    () => {
      if (carrito.items.length === 0) return
      setConfirmarLimpiarOpen(true)
    },
    { ignoreInInputs: false, preventDefault: true, enabled: !hayModalAbierto }
  )

  const productosFiltrados = useMemo(
    () =>
      rankear(
        productos,
        busqueda,
        (p) =>
          `${p.nombre} ${p.sku_base} ${p.marca_nombre ?? ''} ${p.categoria_nombre ?? ''}`
      ),
    [productos, busqueda]
  )

  function agregarUnaVariante(
    producto: ProductoCaja,
    variante: VarianteCaja,
    cantidad = 1
  ) {
    carrito.agregarItem(
      {
        varianteId: variante.id,
        productoId: producto.id,
        productoNombre: producto.nombre,
        productoSku: producto.sku_base,
        imagenUrl: producto.imagen_url,
        atributos: variante.atributos,
        skuVariante: variante.sku_variante,
        precioUnitarioNeto: producto.precio_neto,
        stockDisponible: variante.stock,
        trackStock: producto.track_stock,
      },
      cantidad
    )
  }

  function handleScan(codigo: string) {
    const normalizado = normalizarCodigoBarras(codigo)

    let match: { producto: ProductoCaja; variante: VarianteCaja } | null = null
    for (const p of productos) {
      const v = p.variantes.find(
        (v) =>
          v.codigo_barras !== null &&
          normalizarCodigoBarras(v.codigo_barras) === normalizado
      )
      if (v) {
        match = { producto: p, variante: v }
        break
      }
    }

    if (!match) {
      beepError()
      toast.error(`Código no encontrado: ${codigo}`)
      return
    }

    agregarUnaVariante(match.producto, match.variante, 1)
    beepExito()
    const label = formatAtributos(match.variante.atributos)
    toast.success(
      label ? `${match.producto.nombre} — ${label}` : match.producto.nombre,
      { duration: 1500 }
    )
  }

  function agregarSeleccionMultiple(
    producto: ProductoCaja,
    seleccion: Array<{ variante: VarianteCaja; cantidad: number }>
  ) {
    for (const { variante, cantidad } of seleccion) {
      agregarUnaVariante(producto, variante, cantidad)
    }
    const totalUnidades = seleccion.reduce((acc, s) => acc + s.cantidad, 0)
    toast.success(
      `${producto.nombre} · ${totalUnidades} ${totalUnidades === 1 ? 'unidad agregada' : 'unidades agregadas'}`,
      { duration: 1800 }
    )
  }

  function handleProductoClick(producto: ProductoCaja) {
    if (producto.variantes.length === 1) {
      const v = producto.variantes[0]
      if (producto.track_stock && v.stock <= 0) {
        toast.error('Sin stock disponible')
        return
      }
      agregarUnaVariante(producto, v, 1)
      const label = formatAtributos(v.atributos)
      toast.success(
        label ? `${producto.nombre} — ${label}` : producto.nombre,
        { duration: 1500 }
      )
      return
    }

    setProductoSelector(producto)
  }

  function handleCobrar() {
    if (!puedeCobrarDirecto) return
    if (carrito.items.length === 0) {
      toast.error('El carrito está vacío')
      return
    }
    setCarritoSheetOpen(false)
    setModalCobroOpen(true)
  }

  function handleGuardarPedido() {
    if (carrito.items.length === 0) {
      toast.error('El carrito está vacío')
      return
    }
    setCarritoSheetOpen(false)
    setModalGuardarOpen(true)
  }

  function handleVentaCerrada() {
    carrito.limpiar()
    router.refresh()
  }

  function handlePedidoGuardado(_ventaId: string, numero: number) {
    carrito.limpiar()
    // numero=0 indica pedido guardado offline (no hay nada en el server que
    // refrescar). Solo refrescamos cuando el pedido fue al server (numero > 0).
    if (numero > 0) {
      router.refresh()
    }
  }

  function handleLimpiarConfirmado() {
    carrito.limpiar()
    setConfirmarLimpiarOpen(false)
    toast.success('Carrito vaciado', { duration: 1200 })
  }

  return (
    <>
      {/* Banner del turno activo: muestra base + apertura + botón cerrar. */}
      <BannerTurno turno={turnoActivo} />

      {/*
        Indicador discreto cuando los datos vienen de cache local (offline).
        Se posiciona arriba del search bar para que vendedora sepa que está
        operando con catálogo cacheado.
      */}
      {isOfflineSource && (
        <div className="border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning flex items-center gap-2">
          <WifiOff className="size-3.5 shrink-0" />
          <span>
            Modo offline · Catálogo desde cache local. Verificá stock antes de
            confirmar.
          </span>
        </div>
      )}

      <div className="flex h-[calc(100vh-theme(spacing.14))]">
        {/* Productos: ocupa todo el ancho disponible */}
        <div className="flex flex-1 flex-col min-w-0">
          <div className="border-b bg-background p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={busquedaInputRef}
                placeholder="Buscar producto por nombre, SKU o categoría..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const valor = busqueda.trim()
                    if (pareceCodigoBarras(valor)) {
                      e.preventDefault()
                      setBusqueda('')
                      handleScan(valor)
                    }
                  }
                }}
                className="pl-9 pr-16 h-11 text-base"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium font-numeric text-muted-foreground hidden md:inline-flex">
                /
              </kbd>
            </div>
          </div>

          {/*
            Padding bottom extra en mobile/tablet para que el último row de
            productos no quede tapado por el botón flotante del carrito.
          */}
          <div className="flex-1 overflow-y-auto no-scrollbar p-4 pb-24 lg:pb-4">
            {productosFiltrados.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  {busqueda
                    ? 'No se encontraron productos'
                    : 'No hay productos cargados'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {productosFiltrados.map((producto, index) => (
                  <ProductoTile
                    key={producto.id}
                    producto={producto}
                    onClick={() => handleProductoClick(producto)}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/*
          Carrito DESKTOP: panel lateral fijo de 380px.
          Solo visible en lg+ (1024px). En tablet/mobile, el carrito vive
          en el Sheet drawer de abajo.
        */}
        <aside className="hidden lg:block w-[380px] shrink-0 border-l">
          <CarritoPanel
            items={carrito.items}
            subtotal={carrito.subtotal}
            descuentoValor={carrito.descuentoValor}
            descuentoModo={carrito.descuentoModo}
            descuentoAplicado={carrito.descuentoAplicado}
            total={carrito.total}
            cantidadItems={carrito.cantidadItems}
            onCantidadChange={carrito.actualizarCantidad}
            onRemove={carrito.removerItem}
            onLimpiar={() => setConfirmarLimpiarOpen(true)}
            onCobrar={handleCobrar}
            onGuardarPedido={handleGuardarPedido}
            onDescuentoValorChange={carrito.setDescuentoValor}
            onDescuentoModoChange={carrito.setDescuentoModo}
            puedeCobrarDirecto={puedeCobrarDirecto}
          />
        </aside>
      </div>

      {/*
        Carrito TABLET/MOBILE: drawer desde la derecha.
        Solo se muestra en < lg. Se abre con el botón flotante.
      */}
      <Sheet open={carritoSheetOpen} onOpenChange={setCarritoSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 lg:hidden flex flex-col gap-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Carrito</SheetTitle>
          </SheetHeader>
          <CarritoPanel
            items={carrito.items}
            subtotal={carrito.subtotal}
            descuentoValor={carrito.descuentoValor}
            descuentoModo={carrito.descuentoModo}
            descuentoAplicado={carrito.descuentoAplicado}
            total={carrito.total}
            cantidadItems={carrito.cantidadItems}
            onCantidadChange={carrito.actualizarCantidad}
            onRemove={carrito.removerItem}
            onLimpiar={() => setConfirmarLimpiarOpen(true)}
            onCobrar={handleCobrar}
            onGuardarPedido={handleGuardarPedido}
            onDescuentoValorChange={carrito.setDescuentoValor}
            onDescuentoModoChange={carrito.setDescuentoModo}
            puedeCobrarDirecto={puedeCobrarDirecto}
          />
        </SheetContent>
      </Sheet>

      {/*
        Botón flotante "Ver carrito" en tablet/mobile.
        Solo visible en < lg. Muestra cantidad de items + total.
        Cuando el carrito está vacío, sigue visible pero deshabilitado para
        que la vendedora sepa dónde está.
      */}
      <button
        type="button"
        onClick={() => setCarritoSheetOpen(true)}
        disabled={carrito.items.length === 0}
        className={cn(
          'lg:hidden fixed bottom-4 right-4 z-40',
          'flex items-center gap-3 rounded-full px-5 py-3.5',
          'bg-primary text-primary-foreground',
          'shadow-lg ring-1 ring-primary/20',
          'transition-all duration-200',
          'active:scale-95',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
          'min-h-[56px] min-w-[56px]'
        )}
        aria-label={`Ver carrito (${carrito.cantidadItems} items)`}
      >
        <div className="relative shrink-0">
          <ShoppingCart className="size-5" />
          {carrito.cantidadItems > 0 && (
            <span
              className={cn(
                'absolute -top-1.5 -right-2',
                'inline-flex items-center justify-center',
                'min-w-[1.125rem] h-[1.125rem] px-1 rounded-full',
                'text-[10px] font-bold font-numeric tabular-nums',
                'bg-background text-foreground',
                'ring-2 ring-primary'
              )}
            >
              {carrito.cantidadItems > 99 ? '99+' : carrito.cantidadItems}
            </span>
          )}
        </div>
        {carrito.items.length > 0 && (
          <span className="font-semibold font-numeric text-sm">
            {formatARS(carrito.total)}
          </span>
        )}
      </button>

      <SelectorVariantes
        producto={productoSelector}
        open={productoSelector !== null}
        onOpenChange={(open) => {
          if (!open) setProductoSelector(null)
        }}
        onAgregar={agregarSeleccionMultiple}
      />

      {puedeCobrarDirecto && (
        <ModalCobro
          open={modalCobroOpen}
          onOpenChange={setModalCobroOpen}
          items={carrito.items}
          clientes={clientes}
          clienteId={carrito.clienteId}
          onClienteChange={carrito.setClienteId}
          subtotal={carrito.subtotal}
          descuentoAplicado={carrito.descuentoAplicado}
          total={carrito.total}
          descuentoValor={carrito.descuentoValor}
          descuentoModo={carrito.descuentoModo}
          onDescuentoValorChange={carrito.setDescuentoValor}
          onDescuentoModoChange={carrito.setDescuentoModo}
          recargoManualHabilitado={recargoManualHabilitado}
          recargo105Habilitado={recargo105Habilitado}
          onVentaCerrada={handleVentaCerrada}
        />
      )}

      <ModalGuardarPedido
        open={modalGuardarOpen}
        onOpenChange={setModalGuardarOpen}
        items={carrito.items}
        clientes={clientes}
        clienteId={carrito.clienteId}
        onClienteChange={carrito.setClienteId}
        subtotal={carrito.subtotal}
        onPedidoGuardado={handlePedidoGuardado}
        userId={user.id}
      />

      <AlertDialog
        open={confirmarLimpiarOpen}
        onOpenChange={setConfirmarLimpiarOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vaciar el carrito</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar {carrito.cantidadItems}{' '}
              {carrito.cantidadItems === 1 ? 'unidad' : 'unidades'} del
              carrito. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLimpiarConfirmado}>
              Vaciar carrito
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ProductoTile({
  producto,
  onClick,
  index,
}: {
  producto: ProductoCaja
  onClick: () => void
  index: number
}) {
  const sinStock = producto.track_stock && producto.stock_total === 0
  const stockBajo =
    producto.track_stock &&
    producto.stock_total > 0 &&
    producto.stock_total <= 5

  return (
    <Card
      onClick={sinStock ? undefined : onClick}
      interactive={!sinStock}
      className={cn(
        'group relative overflow-hidden enter-up',
        sinStock && 'opacity-50 cursor-not-allowed'
      )}
      style={{ animationDelay: `${Math.min(index * 25, 250)}ms` }}
    >
      <div className="relative aspect-square w-full bg-muted">
        {producto.imagen_url ? (
          <Image
            src={producto.imagen_url}
            alt={producto.nombre}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
            className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="size-10 text-muted-foreground/40" />
          </div>
        )}

        {sinStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Badge variant="destructive" className="text-xs">
              Sin stock
            </Badge>
          </div>
        )}
        {stockBajo && !sinStock && (
          <div className="absolute top-1.5 right-1.5">
            <Badge
              variant="outline"
              className="text-[10px] bg-background/90 border-warning/50 text-warning"
            >
              Stock bajo
            </Badge>
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-1">
        <p className="text-sm font-medium leading-tight line-clamp-3 min-h-[3.6rem]" title={producto.nombre}>
          {producto.nombre}
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="font-numeric font-semibold text-sm">
            {formatARS(producto.precio_neto)}
          </p>
          <p className="text-[10px] text-muted-foreground font-numeric truncate">
            {producto.sku_base}
          </p>
        </div>
        {producto.track_stock && !sinStock && (
          <p className="text-[10px] text-muted-foreground">
            Stock: {producto.stock_total}
            {producto.variantes.length > 1 && (
              <span className="ml-1">· {producto.variantes.length} var.</span>
            )}
          </p>
        )}
      </div>
    </Card>
  )
}