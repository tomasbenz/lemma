// src/app/(app)/admin/auditoria/_components/auditoria-view.tsx
'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Shield,
  User,
  Package,
  Receipt,
  Users as UsersIcon,
  Settings,
  ChevronRight,
  ChevronLeft,
  X,
  ChevronDown,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type {
  AuditEntry,
  FiltrosAuditoria,
} from '@/lib/queries/auditoria'

type Props = {
  entries: AuditEntry[]
  total: number
  page: number
  limit: number
  filtros: FiltrosAuditoria
  facetas: { entidades: string[]; acciones: string[] }
}

const ENTIDAD_LABEL: Record<string, string> = {
  ventas: 'Venta',
  productos: 'Producto',
  clientes: 'Cliente',
  usuarios: 'Usuario',
  variantes: 'Variante',
  configuracion: 'Configuración',
}

const ENTIDAD_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ventas: Receipt,
  productos: Package,
  clientes: UsersIcon,
  usuarios: User,
  variantes: Package,
  configuracion: Settings,
}

const ACCION_LABEL: Record<string, string> = {
  crear_producto: 'Creó producto',
  actualizar_producto: 'Editó producto',
  eliminar_producto: 'Desactivó producto',
  cerrar_venta: 'Cerró venta',
  anular_venta: 'Anuló venta',
  crear_cliente: 'Creó cliente',
  actualizar_cliente: 'Editó cliente',
  cambiar_estado_cliente: 'Cambió estado cliente',
  actualizar_stock: 'Ajustó stock',
  actualizar_configuracion: 'Cambió configuración',
  emitir_factura: 'Emitió factura',
  login: 'Inició sesión',
  logout: 'Cerró sesión',
}

export function AuditoriaView({
  entries,
  total,
  page,
  limit,
  filtros,
  facetas,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const actualizar = (patch: Partial<FiltrosAuditoria & { page: number }>) => {
    const url = new URL(window.location.href)
    const allowed: Array<keyof typeof patch> = [
      'entidad',
      'accion',
      'desde',
      'hasta',
      'page',
    ]
    for (const k of allowed) {
      const v = patch[k]
      if (v === undefined) continue
      if (v === null || v === '' || v === 'todas') {
        url.searchParams.delete(k)
      } else {
        url.searchParams.set(k, String(v))
      }
    }
    if (!('page' in patch) && url.searchParams.has('page')) {
      url.searchParams.delete('page')
    }

    startTransition(() => {
      router.replace(`${url.pathname}${url.search}`, { scroll: false })
    })
  }

  const limpiarFiltros = () => {
    startTransition(() => {
      router.replace('/admin/auditoria', { scroll: false })
    })
  }

  const hayFiltros =
    !!filtros.entidad ||
    !!filtros.accion ||
    !!filtros.desde ||
    !!filtros.hasta

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      className={cn(
        'space-y-4 transition-opacity duration-200',
        isPending && 'opacity-60'
      )}
    >
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 enter-fade">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Entidad:</span>
          <Select
            value={filtros.entidad ?? 'todas'}
            onValueChange={(v) => actualizar({ entidad: v })}
          >
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {facetas.entidades.map((e) => (
                <SelectItem key={e} value={e}>
                  {ENTIDAD_LABEL[e] ?? e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Acción:</span>
          <Select
            value={filtros.accion ?? 'todas'}
            onValueChange={(v) => actualizar({ accion: v })}
          >
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {facetas.acciones.map((a) => (
                <SelectItem key={a} value={a}>
                  {ACCION_LABEL[a] ?? a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hayFiltros && (
          <Button
            variant="ghost"
            size="sm"
            onClick={limpiarFiltros}
            className="h-9 text-muted-foreground"
          >
            <X className="size-3.5 mr-1" />
            Limpiar
          </Button>
        )}

        <div className="flex-1" />

        {total > 0 && (
          <p className="text-xs text-muted-foreground font-numeric">
            Mostrando {(page - 1) * limit + 1}–
            {Math.min(page * limit, total)} de {total}
          </p>
        )}
      </div>

      {/* Tabla */}
      {entries.length === 0 ? (
        <EmptyState
          icon={<Shield />}
          title="No hay registros"
          description={
            hayFiltros
              ? 'Probá cambiar los filtros.'
              : 'Todavía no hay acciones registradas.'
          }
          action={
            hayFiltros ? (
              <Button variant="outline" onClick={limpiarFiltros}>
                Limpiar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border overflow-hidden surface-1 enter-up">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-40">Fecha</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  expanded={expanded.has(e.id)}
                  onToggle={() => toggleExpand(e.id)}
                />
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
            onClick={() => actualizar({ page: page - 1 })}
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
            onClick={() => actualizar({ page: page + 1 })}
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

function EntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry
  expanded: boolean
  onToggle: () => void
}) {
  const Icon = ENTIDAD_ICON[entry.entidad] ?? FileText
  const entidadLabel = ENTIDAD_LABEL[entry.entidad] ?? entry.entidad
  const accionLabel = ACCION_LABEL[entry.accion] ?? entry.accion

  const detalleKeys = entry.detalle ? Object.keys(entry.detalle) : []
  const tieneDetalle = detalleKeys.length > 0

  const recursoUrl = useMemo(() => {
    if (!entry.entidad_id) return null
    switch (entry.entidad) {
      case 'ventas':
        return `/admin/ventas/${entry.entidad_id}`
      case 'productos':
        return `/admin/productos/${entry.entidad_id}`
      case 'clientes':
        return `/admin/clientes/${entry.entidad_id}`
      default:
        return null
    }
  }, [entry.entidad, entry.entidad_id])

  return (
    <>
      <TableRow
        className={cn(
          'transition-colors duration-200 hover:bg-muted/40',
          tieneDetalle && 'cursor-pointer'
        )}
        onClick={tieneDetalle ? onToggle : undefined}
      >
        <TableCell className="text-xs text-muted-foreground font-numeric">
          <FechaCorta fecha={entry.created_at} />
        </TableCell>
        <TableCell className="text-sm truncate max-w-[200px]">
          {entry.usuario_email}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-xs gap-1">
            <Icon className="size-3" />
            {entidadLabel}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{accionLabel}</span>
            {entry.es_accion_superadmin && (
              <Badge
                variant="outline"
                className="text-[10px] py-0 px-1.5 text-warning border-warning/40 bg-warning/10"
              >
                SUPERADMIN
              </Badge>
            )}
            {recursoUrl && (
              <Link
                href={recursoUrl}
                className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 shrink-0 transition-colors duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                Ver
              </Link>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          {tieneDetalle && (
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
          )}
        </TableCell>
      </TableRow>

      {expanded && tieneDetalle && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={5} className="py-3">
            <div className="enter-fade">
              <DetalleEntry entry={entry} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function DetalleEntry({ entry }: { entry: AuditEntry }) {
  if (!entry.detalle) return null

  const rows = Object.entries(entry.detalle).map(([k, v]) => ({
    key: k,
    value: typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v),
  }))

  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex gap-2">
            <span className="text-muted-foreground shrink-0">{r.key}:</span>
            <span className="font-numeric break-all">{r.value}</span>
          </div>
        ))}
        {entry.ip && (
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">IP:</span>
            <span className="font-numeric">{entry.ip}</span>
          </div>
        )}
      </div>
      {entry.motivo_superadmin && (
        <div className="p-2 rounded border border-warning/30 bg-warning/5 text-xs">
          <span className="text-muted-foreground">Motivo superadmin:</span>{' '}
          {entry.motivo_superadmin}
        </div>
      )}
    </div>
  )
}

function FechaCorta({ fecha }: { fecha: string }) {
  const d = new Date(fecha)
  const str = d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return <span>{str}</span>
}