'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { OpcionCatalogo } from '@/lib/queries/productos'

// Radix Select no permite value="". Sentinela para "todas las marcas".
const TODAS = '__todas__'

export function AumentoMarcaSelect({
  marcas,
  value,
  onChange,
}: {
  marcas: OpcionCatalogo[]
  /** null = todas las marcas (proxy de "todos los proveedores"). */
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Proveedor / Marca</Label>
      <Select
        value={value ?? TODAS}
        onValueChange={(v) => onChange(v === TODAS ? null : v)}
      >
        <SelectTrigger size="sm" className="w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={TODAS}>Todas las marcas</SelectItem>
          {marcas.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
