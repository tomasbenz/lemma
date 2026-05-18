'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, AlertCircle, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export type ComboboxOption = {
  id: string
  nombre: string
  nombre_normalizado: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyLabel?: string
  searchPlaceholder?: string
  className?: string
}

// ============ FUZZY MATCHING ============

/**
 * Distancia de Levenshtein: cuenta cuántos caracteres hay que cambiar
 * para convertir un string en otro. Menor distancia = más parecidos.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // sustitución
          matrix[i][j - 1] + 1,     // inserción
          matrix[i - 1][j] + 1      // eliminación
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

/**
 * Normaliza un string: lowercase, trim, sin acentos.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Busca opciones que coincidan con la búsqueda.
 * Devuelve: matches exactos (substring) y sugerencias similares (fuzzy).
 */
function buscarOpciones(
  options: ComboboxOption[],
  busqueda: string
): {
  matches: ComboboxOption[]
  sugerencias: ComboboxOption[]
  existeExacto: boolean
} {
  const q = normalize(busqueda)
  if (!q) {
    return { matches: options, sugerencias: [], existeExacto: true }
  }

  const matches: ComboboxOption[] = []
  const candidatosSimilares: Array<{
    opcion: ComboboxOption
    distancia: number
  }> = []
  let existeExacto = false

  for (const opcion of options) {
    const nombreNorm = opcion.nombre_normalizado

    if (nombreNorm === q) {
      existeExacto = true
      matches.push(opcion)
      continue
    }

    if (nombreNorm.includes(q) || q.includes(nombreNorm)) {
      matches.push(opcion)
      continue
    }

    // Fuzzy match: si la distancia es pequeña, es una sugerencia de typo
    const distancia = levenshtein(nombreNorm, q)
    const maxLen = Math.max(nombreNorm.length, q.length)
    const ratio = distancia / maxLen

    // Umbral: acepta typos de hasta ~30% de diferencia
    if (distancia <= 2 || ratio < 0.3) {
      candidatosSimilares.push({ opcion, distancia })
    }
  }

  // Ordenar sugerencias por similitud (menor distancia primero)
  const sugerencias = candidatosSimilares
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, 3)
    .map((c) => c.opcion)

  return { matches, sugerencias, existeExacto }
}

// ============ COMPONENTE ============

export function ComboboxCatalogo({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar...',
  emptyLabel = 'Sin resultados',
  searchPlaceholder = 'Buscar o escribir...',
  className,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [busqueda, setBusqueda] = React.useState('')

  const { matches, sugerencias, existeExacto } = React.useMemo(
    () => buscarOpciones(options, busqueda),
    [options, busqueda]
  )

  const handleSelect = (nombre: string) => {
    onChange(nombre)
    setBusqueda('')
    setOpen(false)
  }

  const handleCreate = () => {
    const nuevoValor = busqueda.trim()
    if (!nuevoValor) return
    onChange(nuevoValor)
    setBusqueda('')
    setOpen(false)
  }

  const mostrarCrear = busqueda.trim().length > 0 && !existeExacto

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={busqueda}
            onValueChange={setBusqueda}
          />
          <CommandList>
            {matches.length === 0 &&
              sugerencias.length === 0 &&
              !mostrarCrear && <CommandEmpty>{emptyLabel}</CommandEmpty>}

            {/* Matches exactos o por substring */}
            {matches.length > 0 && (
              <CommandGroup heading="Catálogo">
                {matches.map((opcion) => (
                  <CommandItem
                    key={opcion.id}
                    value={opcion.nombre}
                    onSelect={() => handleSelect(opcion.nombre)}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        value === opcion.nombre
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    {opcion.nombre}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Sugerencias fuzzy: typos probables */}
            {sugerencias.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="¿Quisiste decir?">
                  {sugerencias.map((opcion) => (
                    <CommandItem
                      key={opcion.id}
                      value={opcion.nombre}
                      onSelect={() => handleSelect(opcion.nombre)}
                      className="text-muted-foreground"
                    >
                      <Check className="mr-2 size-4 opacity-0" />
                      {opcion.nombre}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Crear nuevo (con advertencia) */}
            {mostrarCrear && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Agregar al catálogo">
                  <CommandItem
                    onSelect={handleCreate}
                    className="flex-col items-start gap-1.5 py-3"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Plus className="size-4 text-warning" />
                      <span className="font-medium">
                        Crear &quot;{busqueda.trim()}&quot;
                      </span>
                    </div>
                    {sugerencias.length > 0 ? (
                      <div className="flex items-start gap-2 pl-6 w-full">
                        <AlertCircle className="size-3 mt-0.5 shrink-0 text-warning" />
                        <span className="text-xs text-muted-foreground">
                          Asegurate que no quisiste decir:{' '}
                          <span className="font-medium text-foreground">
                            {sugerencias.map((s) => s.nombre).join(', ')}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground pl-6">
                        Se agregará permanentemente al catálogo
                      </span>
                    )}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}