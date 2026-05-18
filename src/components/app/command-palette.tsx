'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Package,
  Receipt,
  ShoppingCart,
  Home,
  Users,
  Plus,
  Search,
  Inbox,
} from 'lucide-react'
import { Command } from 'cmdk'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  cargarProductosGlobal,
  buscarVentasPorNumero,
} from '@/lib/actions/buscar-global'
import type {
  ProductoGlobal,
  VentaGlobal,
} from '@/lib/actions/buscar-global-types'
import type { CurrentUser } from '@/lib/auth/get-current-user'

type Props = {
  rol: CurrentUser['rol']
}

export function CommandPalette({ rol }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [productos, setProductos] = useState<ProductoGlobal[]>([])
  const [ventas, setVentas] = useState<VentaGlobal[]>([])
  const productosCargados = useRef(false)

  const puedeVerAdmin = rol !== 'vendedor'

  // Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Al abrir: cargar productos una sola vez (cache de por vida del componente)
  useEffect(() => {
    if (!open) return
    if (productosCargados.current) return

    productosCargados.current = true
    cargarProductosGlobal().then((data) => setProductos(data))
  }, [open])

  // Al cerrar: limpiar query pero mantener el cache
  useEffect(() => {
    if (!open) {
      setQuery('')
      setVentas([])
    }
  }, [open])

  // ===== Filtrado LOCAL de productos =====
  // Esto es instantáneo, sin server roundtrip
  const productosFiltrados = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    return productos
      .filter((p) => {
        return (
          p.nombre.toLowerCase().includes(q) ||
          p.sku_base.toLowerCase().includes(q) ||
          p.categoria?.toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
  }, [query, productos])

  // ===== Búsqueda de ventas (solo si es numérico) =====
  useEffect(() => {
    const q = query.trim()
    if (!q || !puedeVerAdmin) {
      setVentas([])
      return
    }

    const numero = parseInt(q.replace(/[#\s]/g, ''), 10)
    if (isNaN(numero)) {
      setVentas([])
      return
    }

    let cancelado = false
    buscarVentasPorNumero(numero).then((data) => {
      if (!cancelado) setVentas(data)
    })
    return () => {
      cancelado = true
    }
  }, [query, puedeVerAdmin])

  function navegar(ruta: string) {
    setOpen(false)
    setTimeout(() => router.push(ruta), 0)
  }

  const tieneQuery = query.trim().length > 0
  const noHayResultados =
    tieneQuery && productosFiltrados.length === 0 && ventas.length === 0

  const totalFormatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="!max-w-2xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden [&>button]:hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Búsqueda global</DialogTitle>

        <Command shouldFilter={false} className="flex flex-col max-h-[70vh]" loop>
          <div className="flex items-center border-b px-4 shrink-0">
            <Search className="size-4 text-muted-foreground shrink-0 mr-2" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar productos, ventas, acciones..."
              className="flex-1 bg-transparent py-4 text-base outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium font-numeric text-muted-foreground">
              Esc
            </kbd>
          </div>

          <Command.List className="flex-1 overflow-y-auto p-2 no-scrollbar">
            {noHayResultados && (
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                No se encontraron resultados para &ldquo;{query}&rdquo;
              </Command.Empty>
            )}

            {productosFiltrados.length > 0 && (
              <Grupo heading="Productos">
                {productosFiltrados.map((p) => (
                  <Item
                    key={p.id}
                    onSelect={() => navegar(`/admin/productos/${p.id}`)}
                    icono={
                      p.imagen_url ? (
                        <div className="relative size-7 overflow-hidden rounded border bg-muted shrink-0">
                          <Image
                            src={p.imagen_url}
                            alt=""
                            fill
                            sizes="28px"
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="flex size-7 items-center justify-center rounded border bg-muted shrink-0">
                          <Package className="size-3.5 text-muted-foreground" />
                        </div>
                      )
                    }
                    titulo={p.nombre}
                    subtitulo={p.sku_base}
                    meta={p.categoria ?? undefined}
                  />
                ))}
              </Grupo>
            )}

            {ventas.length > 0 && (
              <Grupo heading="Ventas">
                {ventas.map((v) => (
                  <Item
                    key={v.id}
                    onSelect={() => navegar(`/admin/ventas/${v.id}`)}
                    icono={<Receipt className="size-4 text-muted-foreground" />}
                    titulo={`Venta #${v.numero}`}
                    subtitulo={v.cliente}
                    meta={`${v.fecha} · ${totalFormatter.format(v.total)}`}
                  />
                ))}
              </Grupo>
            )}

            {!tieneQuery && (
              <>
                <Grupo heading="Acciones">
                  {puedeVerAdmin && (
                    <Item
                      onSelect={() => navegar('/admin/productos/nuevo')}
                      icono={<Plus className="size-4 text-muted-foreground" />}
                      titulo="Crear producto"
                    />
                  )}
                  <Item
                    onSelect={() => navegar('/caja')}
                    icono={<ShoppingCart className="size-4 text-muted-foreground" />}
                    titulo="Ir a la caja"
                    atajo="G C"
                  />
                </Grupo>

                <Grupo heading="Navegación">
                  {puedeVerAdmin && (
                    <>
                      <Item
                        onSelect={() => navegar('/admin')}
                        icono={<Home className="size-4 text-muted-foreground" />}
                        titulo="Panel"
                        atajo="G H"
                      />
                      <Item
                        onSelect={() => navegar('/admin/productos')}
                        icono={<Package className="size-4 text-muted-foreground" />}
                        titulo="Productos"
                        atajo="G P"
                      />
                      <Item
                        onSelect={() => navegar('/admin/ventas')}
                        icono={<Receipt className="size-4 text-muted-foreground" />}
                        titulo="Ventas"
                        atajo="G V"
                      />
                      <Item
                        onSelect={() => navegar('/admin/clientes')}
                        icono={<Users className="size-4 text-muted-foreground" />}
                        titulo="Clientes"
                      />
                    </>
                  )}
                  {!puedeVerAdmin && (
                    <>
                      <Item
                        onSelect={() => navegar('/caja')}
                        icono={<ShoppingCart className="size-4 text-muted-foreground" />}
                        titulo="Caja"
                        atajo="G C"
                      />
                      <Item
                        onSelect={() => navegar('/admin/pedidos')}
                        icono={<Inbox className="size-4 text-muted-foreground" />}
                        titulo="Mis pedidos"
                      />
                      <Item
                        onSelect={() => navegar('/admin/productos')}
                        icono={<Package className="size-4 text-muted-foreground" />}
                        titulo="Productos"
                        atajo="G P"
                      />
                    </>
                  )}
                </Grupo>
              </>
            )}
          </Command.List>

          <div className="border-t px-3 py-2 flex items-center justify-between text-[10px] text-muted-foreground shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                navegar
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Enter</Kbd>
                seleccionar
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              abrir
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Grupo({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  )
}

function Item({
  onSelect,
  icono,
  titulo,
  subtitulo,
  meta,
  atajo,
}: {
  onSelect: () => void
  icono?: React.ReactNode
  titulo: string
  subtitulo?: string
  meta?: string
  atajo?: string
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-2 text-sm cursor-pointer',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
      )}
    >
      {icono && <div className="shrink-0">{icono}</div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{titulo}</span>
          {meta && (
            <span className="text-xs text-muted-foreground font-numeric shrink-0">
              · {meta}
            </span>
          )}
        </div>
        {subtitulo && (
          <p className="text-xs text-muted-foreground truncate">{subtitulo}</p>
        )}
      </div>
      {atajo && (
        <div className="flex items-center gap-1 shrink-0">
          {atajo.split(' ').map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </div>
      )}
    </Command.Item>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded border bg-muted px-1 text-[10px] font-medium font-numeric text-muted-foreground">
      {children}
    </kbd>
  )
}