// src/components/app/sortable-header.tsx
'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type SortDir = 'asc' | 'desc'

type Props<TColumn extends string> = {
  column: TColumn
  label: string
  currentColumn: TColumn
  currentDir: SortDir
  onClick: (col: TColumn) => void
  /**
   * Alineación del contenido. Default 'left'.
   */
  align?: 'left' | 'center' | 'right'
  /**
   * Clases extra para el TableHead (ej: w-20).
   */
  className?: string
}

/**
 * Header de tabla clickeable para sort.
 * Al hacer click en una columna nueva, ordena ascendente (o descendente
 * para columnas numéricas/fecha — eso lo decide el padre desde onClick).
 * Si ya está activa, alterna entre asc/desc.
 *
 * Uso:
 *   <SortableHeader
 *     column="numero"
 *     label="N°"
 *     currentColumn={sortColumn}
 *     currentDir={sortDir}
 *     onClick={toggleSort}
 *     className="w-20"
 *   />
 */
export function SortableHeader<TColumn extends string>({
  column,
  label,
  currentColumn,
  currentDir,
  onClick,
  align = 'left',
  className,
}: Props<TColumn>) {
  const active = currentColumn === column

  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  const textAlign =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <TableHead className={cn(textAlign, className)}>
      <button
        type="button"
        onClick={() => onClick(column)}
        className={cn(
          'flex items-center gap-1 transition-colors duration-200 hover:text-foreground w-full',
          justify,
          active ? 'text-foreground font-semibold' : 'text-muted-foreground'
        )}
      >
        <span>{label}</span>
        {active ? (
          currentDir === 'asc' ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}