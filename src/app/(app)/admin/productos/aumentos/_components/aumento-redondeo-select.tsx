'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  LABELS_REDONDEO,
  type EstrategiaRedondeo,
} from '@/lib/precios/redondeo'

const ORDEN: EstrategiaRedondeo[] = ['none', 'r10', 'r50', 'r100']

export function AumentoRedondeoSelect({
  value,
  onChange,
}: {
  value: EstrategiaRedondeo
  onChange: (v: EstrategiaRedondeo) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Redondeo</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as EstrategiaRedondeo)}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ORDEN.map((e) => (
            <SelectItem key={e} value={e}>
              {LABELS_REDONDEO[e]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
