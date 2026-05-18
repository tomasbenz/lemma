'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PaginadorProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Paginador clásico con números y elipsis.
 * No maneja URL internamente — la página contenedora le pasa el callback.
 *
 * Lógica de elipsis: muestra siempre la primera, la última, la actual,
 * y vecinas inmediatas (current ± 1). El resto se condensa en "…".
 *
 * Ejemplos:
 * - 5 páginas, current=3: [1] [2] [3] [4] [5]
 * - 20 páginas, current=1: [1] [2] [3] ... [20]
 * - 20 páginas, current=10: [1] ... [9] [10] [11] ... [20]
 * - 20 páginas, current=20: [1] ... [18] [19] [20]
 */
export function Paginador({
  currentPage,
  totalPages,
  onPageChange,
  className,
}: PaginadorProps) {
  if (totalPages <= 1) return null

  const paginas = generarPaginas(currentPage, totalPages)

  const handleAnterior = () => {
    if (currentPage > 1) onPageChange(currentPage - 1)
  }

  const handleSiguiente = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1)
  }

  return (
    <nav
      className={cn('flex items-center justify-center gap-1', className)}
      aria-label="Paginación"
    >
      <Button
        variant="outline"
        size="icon"
        onClick={handleAnterior}
        disabled={currentPage === 1}
        aria-label="Página anterior"
      >
        <ChevronLeft className="size-4" />
      </Button>

      {paginas.map((p, idx) =>
        p === 'ellipsis' ? (
          <span
            key={`ellipsis-${idx}`}
            className="px-2 text-sm text-muted-foreground"
            aria-hidden
          >
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === currentPage ? 'default' : 'outline'}
            size="icon"
            onClick={() => onPageChange(p)}
            aria-label={`Página ${p}`}
            aria-current={p === currentPage ? 'page' : undefined}
            className="font-numeric"
          >
            {p}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="icon"
        onClick={handleSiguiente}
        disabled={currentPage === totalPages}
        aria-label="Página siguiente"
      >
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  )
}

/**
 * Devuelve la secuencia de páginas a renderizar, intercalando 'ellipsis'
 * cuando hay saltos. Asume currentPage y totalPages válidos (>= 1).
 */
function generarPaginas(
  currentPage: number,
  totalPages: number,
): Array<number | 'ellipsis'> {
  // Caso simple: hasta 7 páginas, mostrar todas
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const paginas: Array<number | 'ellipsis'> = []

  paginas.push(1)

  const inicio = Math.max(2, currentPage - 1)
  const fin = Math.min(totalPages - 1, currentPage + 1)

  if (inicio > 2) {
    paginas.push('ellipsis')
  }

  for (let i = inicio; i <= fin; i++) {
    paginas.push(i)
  }

  if (fin < totalPages - 1) {
    paginas.push('ellipsis')
  }

  paginas.push(totalPages)

  return paginas
}
