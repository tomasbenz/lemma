'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListChecks,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'
import type { Operacion } from '@/lib/queries/operaciones'
import { formatearAccion, fechaCorta } from '../_lib/formato'

type Props = {
  operaciones: Operacion[]
  total: number
  page: number
  perPage: number
  accionesSeleccionadas: string[]
  soloConOmitidos: boolean
  facetas: { acciones: string[] }
}

export function OperacionesContent({
  operaciones,
  total,
  page,
  perPage,
  accionesSeleccionadas,
  soloConOmitidos,
  facetas,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  function setParam(patch: Record<string, string | null>, resetPage = true) {
    const url = new URL(window.location.href)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') url.searchParams.delete(k)
      else url.searchParams.set(k, v)
    }
    if (resetPage) url.searchParams.delete('page')
    startTransition(() => {
      router.replace(`${url.pathname}${url.search}`, { scroll: false })
    })
  }

  function toggleAccion(accion: string) {
    const next = accionesSeleccionadas.includes(accion)
      ? accionesSeleccionadas.filter((a) => a !== accion)
      : [...accionesSeleccionadas, accion]
    setParam({ acciones: next.length ? next.join(',') : null })
  }

  const hayFiltros =
    accionesSeleccionadas.length > 0 ||
    soloConOmitidos ||
    new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    ).has('desde')

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              Acción
              {accionesSeleccionadas.length > 0 && (
                <Badge variant="outline" className="ml-1 font-numeric text-[10px]">
                  {accionesSeleccionadas.length}
                </Badge>
              )}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Filtrar por acción</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {facetas.acciones.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Sin operaciones aún
              </p>
            )}
            {facetas.acciones.map((a) => (
              <DropdownMenuCheckboxItem
                key={a}
                checked={accionesSeleccionadas.includes(a)}
                onCheckedChange={() => toggleAccion(a)}
                onSelect={(e) => e.preventDefault()}
              >
                {formatearAccion(a)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Desde</span>
          <Input
            type="date"
            defaultValue={
              new URLSearchParams(
                typeof window !== 'undefined' ? window.location.search : ''
              ).get('desde') ?? ''
            }
            onChange={(e) => setParam({ desde: e.target.value || null })}
            className="h-9 w-36"
          />
          <span className="text-xs text-muted-foreground">Hasta</span>
          <Input
            type="date"
            defaultValue={
              new URLSearchParams(
                typeof window !== 'undefined' ? window.location.search : ''
              ).get('hasta') ?? ''
            }
            onChange={(e) => setParam({ hasta: e.target.value || null })}
            className="h-9 w-36"
          />
        </div>

        <Button
          variant={soloConOmitidos ? 'default' : 'outline'}
          size="sm"
          onClick={() => setParam({ omitidos: soloConOmitidos ? null : '1' })}
        >
          Solo con omitidos
        </Button>

        {hayFiltros && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTransition(() => router.replace('/admin/operaciones', { scroll: false }))}
            className="h-9 text-muted-foreground"
          >
            <X className="size-3.5 mr-1" />
            Limpiar
          </Button>
        )}

        <div className="flex-1" />
        {total > 0 && (
          <p className="text-xs text-muted-foreground font-numeric">
            {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} de{' '}
            {total}
          </p>
        )}
      </div>

      {/* Tabla */}
      {operaciones.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No hay operaciones"
          description={
            hayFiltros
              ? 'Probá cambiar los filtros.'
              : 'Cuando hagas cambios masivos en el catálogo, los vas a ver acá.'
          }
        />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-36">Fecha</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Por</TableHead>
                <TableHead className="text-center w-24">Afectados</TableHead>
                <TableHead className="text-center w-24">Omitidos</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operaciones.map((op) => (
                <TableRow
                  key={op.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => router.push(`/admin/operaciones/${op.id}`)}
                >
                  <TableCell className="text-xs text-muted-foreground font-numeric">
                    {fechaCorta(op.creado_at)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {formatearAccion(op.accion)}
                  </TableCell>
                  <TableCell className="text-sm truncate max-w-[200px]">
                    {op.usuario_email_snapshot}
                  </TableCell>
                  <TableCell className="text-center font-numeric tabular-nums">
                    {op.afectados}
                  </TableCell>
                  <TableCell className="text-center">
                    {op.cantidad_omitidos > 0 ? (
                      <Badge variant="outline" className="font-numeric text-xs">
                        {op.cantidad_omitidos}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParam({ page: String(page - 1) }, false)}
            disabled={page <= 1}
          >
            <ChevronLeft className="size-4 mr-1" />
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground font-numeric">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParam({ page: String(page + 1) }, false)}
            disabled={page >= totalPages}
          >
            Siguiente
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
