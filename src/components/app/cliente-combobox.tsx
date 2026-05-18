// src/components/app/cliente-combobox.tsx
'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, X, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type ClienteOption = {
  id: string
  razon_social: string
  cuit?: string | null
}

type Props = {
  clientes: ClienteOption[]
  value: string | null // id del cliente seleccionado
  onChange: (clienteId: string | null) => void
  placeholder?: string
  className?: string
}

/**
 * Combobox con autocomplete para seleccionar un cliente.
 * Permite limpiar la selección con la X.
 */
export function ClienteCombobox({
  clientes,
  value,
  onChange,
  placeholder = 'Cliente...',
  className,
}: Props) {
  const [open, setOpen] = useState(false)

  const seleccionado = clientes.find((c) => c.id === value) ?? null

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'h-8 justify-between gap-2 font-normal',
              seleccionado ? 'pr-8' : 'pr-2',
              !seleccionado && 'text-muted-foreground'
            )}
          >
            <Users className="size-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">
              {seleccionado ? seleccionado.razon_social : placeholder}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar cliente..." className="h-9" />
            <CommandList>
              <CommandEmpty>No se encontraron clientes.</CommandEmpty>
              <CommandGroup>
                {clientes.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.razon_social} ${c.cuit ?? ''}`}
                    onSelect={() => {
                      onChange(c.id === value ? null : c.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        value === c.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{c.razon_social}</p>
                      {c.cuit && (
                        <p className="text-xs text-muted-foreground font-numeric truncate">
                          {c.cuit}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {seleccionado && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5"
          aria-label="Limpiar cliente"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}