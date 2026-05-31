'use client'

import { Search, ChevronDown, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OpcionCatalogo } from '@/lib/queries/productos'
import type { AumentoFiltros, SortAumento } from '../_actions/buscar-productos'

const SORT_LABEL: Record<SortAumento, string> = {
  nombre: 'Nombre (A-Z)',
  precio_desc: 'Precio (mayor)',
  precio_asc: 'Precio (menor)',
}

function FiltroDropdown({
  label,
  valorActual,
  opciones,
  value,
  onChange,
}: {
  label: string
  valorActual: string
  opciones: OpcionCatalogo[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 justify-between min-w-[180px]">
          <span className="truncate">{valorActual}</span>
          {value && <span className="size-2 rounded-full bg-primary shrink-0" />}
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-96 overflow-y-auto no-scrollbar">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(v) => onChange(v || null)}
        >
          <DropdownMenuRadioItem value="">Todas</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {opciones.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.nombre}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AumentoFiltrosBar({
  marcas,
  categorias,
  filtros,
  sort,
  onFiltrosChange,
  onSortChange,
  onLimpiar,
  hayFiltros,
}: {
  marcas: OpcionCatalogo[]
  categorias: OpcionCatalogo[]
  filtros: AumentoFiltros
  sort: SortAumento
  onFiltrosChange: (patch: Partial<AumentoFiltros>) => void
  onSortChange: (v: SortAumento) => void
  onLimpiar: () => void
  hayFiltros: boolean
}) {
  const marcaNombre =
    marcas.find((m) => m.id === filtros.marca_id)?.nombre ?? 'Todas las marcas'
  const categoriaNombre =
    categorias.find((c) => c.id === filtros.categoria_id)?.nombre ??
    'Todas las categorías'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FiltroDropdown
        label="Marca"
        valorActual={marcaNombre}
        opciones={marcas}
        value={filtros.marca_id}
        onChange={(v) => onFiltrosChange({ marca_id: v })}
      />
      <FiltroDropdown
        label="Categoría"
        valorActual={categoriaNombre}
        opciones={categorias}
        value={filtros.categoria_id}
        onChange={(v) => onFiltrosChange({ categoria_id: v })}
      />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          value={filtros.q ?? ''}
          onChange={(e) => onFiltrosChange({ q: e.target.value || null })}
          placeholder="Nombre o SKU…"
          className="pl-8 w-[200px]"
        />
      </div>

      <Select value={sort} onValueChange={(v) => onSortChange(v as SortAumento)}>
        <SelectTrigger size="sm" className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABEL) as SortAumento[]).map((s) => (
            <SelectItem key={s} value={s}>
              {SORT_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <Checkbox
          checked={filtros.solo_activos}
          onCheckedChange={(v) => onFiltrosChange({ solo_activos: v === true })}
        />
        Solo activos
      </label>

      {hayFiltros && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onLimpiar}
        >
          <X className="size-4 mr-1" />
          Limpiar
        </Button>
      )}
    </div>
  )
}
