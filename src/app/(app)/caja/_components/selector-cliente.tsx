// src/app/(app)/caja/_components/selector-cliente.tsx
'use client'

import { useState, useMemo } from 'react'
import {
  User,
  X,
  Check,
  ChevronDown,
  Search,
  UserPlus,
} from 'lucide-react'
import Link from 'next/link'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Command } from 'cmdk'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { labelCondIva } from '@/lib/queries/clientes-types'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'

type Props = {
  clientes: ClienteCaja[]
  clienteId: string | null
  onChange: (clienteId: string | null) => void
  /**
   * Si true, muestra el botón "Crear cliente nuevo" al pie del popover.
   * Solo debería habilitarse en contextos donde el usuario tiene permisos
   * para acceder a /admin/clientes/nuevo (admin/superadmin).
   * Default: false (más seguro).
   */
  permitirCrearCliente?: boolean
}

export function SelectorCliente({
  clientes,
  clienteId,
  onChange,
  permitirCrearCliente = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const clienteSeleccionado = useMemo(
    () => clientes.find((c) => c.id === clienteId) ?? null,
    [clienteId, clientes]
  )

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clientes.slice(0, 20)

    return clientes
      .filter((c) => {
        return (
          c.razon_social.toLowerCase().includes(q) ||
          c.cuit?.toLowerCase().includes(q)
        )
      })
      .slice(0, 20)
  }, [query, clientes])

  function seleccionar(cliente: ClienteCaja) {
    onChange(cliente.id)
    setOpen(false)
    setQuery('')
  }

  function limpiar(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    onChange(null)
  }

  function onKeyDownLimpiar(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      limpiar(e)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full rounded-md border px-3 py-2 text-sm flex items-center gap-2 text-left',
            'hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            clienteSeleccionado
              ? 'border-foreground/30 bg-muted/30'
              : 'border-dashed border-border'
          )}
        >
          <User
            className={cn(
              'size-4 shrink-0',
              clienteSeleccionado
                ? 'text-foreground'
                : 'text-muted-foreground'
            )}
          />
          {clienteSeleccionado ? (
            <>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {clienteSeleccionado.razon_social}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {labelCondIva(clienteSeleccionado.cond_iva)}
                  {clienteSeleccionado.cuit && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="font-numeric">
                        {clienteSeleccionado.cuit}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <span
                role="button"
                tabIndex={0}
                onClick={limpiar}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={onKeyDownLimpiar}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Quitar cliente"
              >
                <X className="size-3.5" />
              </span>
            </>
          ) : (
            <>
              <span className="flex-1 text-muted-foreground italic">
                Consumidor Final (sin cliente asignado)
              </span>
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0 w-[min(420px,calc(100vw-2rem))]"
        align="start"
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="size-4 text-muted-foreground shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar por razón social o CUIT..."
              className="flex-1 bg-transparent py-3 pl-2 text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <Command.List className="max-h-72 overflow-y-auto no-scrollbar p-1">
            {filtrados.length === 0 && (
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                No se encontraron clientes.
              </Command.Empty>
            )}

            {filtrados.map((c) => (
              <Command.Item
                key={c.id}
                value={c.id}
                onSelect={() => seleccionar(c)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer',
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {c.razon_social}
                    </span>
                    {c.id === clienteId && (
                      <Check className="size-3.5 text-success shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5"
                    >
                      {c.cond_iva}
                    </Badge>
                    {c.cuit && (
                      <span className="font-numeric">{c.cuit}</span>
                    )}
                  </div>
                </div>
              </Command.Item>
            ))}
          </Command.List>

          {/*
            Botón "Crear cliente nuevo" solo se muestra si el usuario tiene
            permiso (admin/superadmin). En caja con vendedora, no aparece.
            target="_blank" + rel="noopener" para abrir en pestaña nueva
            sin perder el contexto del modal/pedido.
          */}
          {permitirCrearCliente && (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="w-full justify-start h-8 text-xs"
              >
                <Link
                  href="/admin/clientes/nuevo"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <UserPlus className="size-3.5 mr-2" />
                  Crear cliente nuevo
                </Link>
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}