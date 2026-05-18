// src/components/historial-cambios/historial-cambios.tsx
'use client'

import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Clock,
  FileMinus,
  FileText,
  History,
  Pencil,
  ShoppingBag,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatARS } from '@/lib/format'
import { formatAtributos } from '@/lib/format-atributos'
import type { HistorialEvento } from '@/lib/queries/historial-venta'

type HistorialCambiosProps = {
  eventos: HistorialEvento[]
}

// ---------- Catálogo de acciones ----------

type LucideIcon = typeof Pencil

type AccionMeta = {
  label: string
  Icon: LucideIcon
}

const ACCION_META: Record<string, AccionMeta> = {
  guardar_pedido: { label: 'Pedido creado', Icon: ShoppingBag },
  editar_pedido: { label: 'Pedido editado', Icon: Pencil },
  editar_venta: { label: 'Venta editada', Icon: Pencil },
  finalizar_pedido: { label: 'Venta cerrada', Icon: Check },
  anular_pedido: { label: 'Pedido anulado', Icon: X },
  anular_venta: { label: 'Venta anulada', Icon: X },
  emitir_factura: { label: 'Factura emitida', Icon: FileText },
  emitir_nota_credito: { label: 'Nota de crédito emitida', Icon: FileMinus },
}

function metaAccion(accion: string): AccionMeta {
  const hit = ACCION_META[accion]
  if (hit) return hit
  const label = accion
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
  return { label, Icon: Clock }
}

// ---------- Formato ----------

function formatFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const LOCALHOST_IPS = new Set(['::1', '127.0.0.1', '0.0.0.0', 'localhost'])
function ipPublica(ip: string | null): string | null {
  if (!ip) return null
  const cleaned = ip.trim()
  if (!cleaned || LOCALHOST_IPS.has(cleaned)) return null
  return cleaned
}

// ---------- Tipos auditoría ----------

type ItemAuditado = {
  variante_id?: string
  producto_nombre?: string
  variante_sku?: string
  variante_atributos?: Record<string, unknown> | null
  cantidad?: number
  precio_unitario_neto?: number
  subtotal_neto?: number
}

type StockAjuste = {
  variante_id?: string
  delta_items?: number
  delta_aplicado?: number
  motivo?: string
}

function leerItems(raw: unknown): ItemAuditado[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is ItemAuditado => typeof e === 'object' && e !== null
  )
}

function descripcionVariante(it: ItemAuditado): string {
  return formatAtributos(it.variante_atributos) || 'Única'
}

function indexar(items: ItemAuditado[]): Map<string, ItemAuditado> {
  const m = new Map<string, ItemAuditado>()
  for (const it of items) {
    if (it.variante_id) m.set(it.variante_id, it)
  }
  return m
}

// ---------- Diff items ----------

type EstadoDiff = 'agregado' | 'eliminado' | 'modificado' | 'igual'

type ItemDiff = {
  item: ItemAuditado
  estado: EstadoDiff
  cantidadOpuesta?: number
}

function diffItems(
  antes: ItemAuditado[],
  despues: ItemAuditado[]
): { antes: ItemDiff[]; despues: ItemDiff[] } {
  const idxAntes = indexar(antes)
  const idxDespues = indexar(despues)

  const diffAntes: ItemDiff[] = antes.map((it) => {
    if (!it.variante_id) return { item: it, estado: 'igual' }
    const corr = idxDespues.get(it.variante_id)
    if (!corr) return { item: it, estado: 'eliminado' }
    if ((corr.cantidad ?? 0) !== (it.cantidad ?? 0)) {
      return { item: it, estado: 'modificado', cantidadOpuesta: corr.cantidad }
    }
    return { item: it, estado: 'igual' }
  })

  const diffDespues: ItemDiff[] = despues.map((it) => {
    if (!it.variante_id) return { item: it, estado: 'igual' }
    const corr = idxAntes.get(it.variante_id)
    if (!corr) return { item: it, estado: 'agregado' }
    if ((corr.cantidad ?? 0) !== (it.cantidad ?? 0)) {
      return { item: it, estado: 'modificado', cantidadOpuesta: corr.cantidad }
    }
    return { item: it, estado: 'igual' }
  })

  return { antes: diffAntes, despues: diffDespues }
}

// ---------- Componente principal ----------

export function HistorialCambios({ eventos }: HistorialCambiosProps) {
  return (
    <Card className="surface-1">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            Historial de cambios
          </span>
          <Badge
            variant="outline"
            className="text-xs font-normal font-numeric"
          >
            {eventos.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay cambios registrados
          </p>
        ) : (
          <ul className="space-y-2">
            {eventos.map((e, i) => (
              <EventoRow key={e.id} evento={e} index={i} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Fila evento ----------

function EventoRow({
  evento,
  index,
}: {
  evento: HistorialEvento
  index: number
}) {
  const [open, setOpen] = useState(false)
  const tieneDetalle =
    !!evento.detalle && Object.keys(evento.detalle).length > 0
  const { label, Icon } = metaAccion(evento.accion)
  const ip = ipPublica(evento.ip)
  const staggerIdx = Math.min(index + 1, 6)

  return (
    <li
      className={cn(
        'rounded-md border bg-card overflow-hidden enter-up',
        `stagger-${staggerIdx}`
      )}
    >
      <button
        type="button"
        onClick={() => tieneDetalle && setOpen((v) => !v)}
        disabled={!tieneDetalle}
        aria-expanded={tieneDetalle ? open : undefined}
        className={cn(
          'w-full text-left flex items-center gap-2.5 px-3 py-2',
          tieneDetalle
            ? 'hover:bg-muted/40 transition-colors cursor-pointer'
            : 'cursor-default'
        )}
      >
        <span className="inline-flex items-center justify-center size-7 rounded-full bg-muted shrink-0">
          <Icon className="size-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-x-2 gap-y-0 flex-wrap leading-tight">
            <span className="text-xs font-medium">{label}</span>
            <span className="text-[11px] text-muted-foreground font-numeric">
              {formatFecha(evento.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-x-2 flex-wrap leading-tight mt-0.5">
            <span
              className={cn(
                'text-[11px] truncate min-w-0',
                evento.usuario_email
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground italic'
              )}
              title={evento.usuario_email ?? 'Sistema'}
            >
              {evento.usuario_email ?? 'Sistema'}
            </span>
            {ip && (
              <span
                className="font-numeric text-[10px] text-muted-foreground/70 px-1 rounded border shrink-0"
                title={`IP: ${ip}`}
              >
                {ip}
              </span>
            )}
          </div>
        </div>
        {tieneDetalle && (
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground shrink-0 transition-transform',
              open && 'rotate-180'
            )}
          />
        )}
      </button>

      {open && tieneDetalle && (
        <div className="px-3 pb-3 pt-2 border-t enter-fade">
          <DetalleEvento accion={evento.accion} detalle={evento.detalle!} />
        </div>
      )}
    </li>
  )
}

// ---------- Detalle ----------

function DetalleEvento({
  accion,
  detalle,
}: {
  accion: string
  detalle: Record<string, unknown>
}) {
  if (accion === 'editar_pedido' || accion === 'editar_venta') {
    return <DetalleEdicion accion={accion} detalle={detalle} />
  }

  return (
    <pre className="text-[10px] font-numeric bg-muted/40 p-2 rounded max-h-64 overflow-auto no-scrollbar whitespace-pre-wrap break-all">
      {JSON.stringify(detalle, null, 2)}
    </pre>
  )
}

function DetalleEdicion({
  accion,
  detalle,
}: {
  accion: string
  detalle: Record<string, unknown>
}) {
  const itemsAntes = useMemo(() => leerItems(detalle.items_antes), [detalle])
  const itemsDespues = useMemo(
    () => leerItems(detalle.items_despues),
    [detalle]
  )
  const diff = useMemo(
    () => diffItems(itemsAntes, itemsDespues),
    [itemsAntes, itemsDespues]
  )

  const subtotalAntes = Number(detalle.subtotal_antes ?? 0)
  const subtotalDespues = Number(detalle.subtotal_despues ?? 0)
  const totalAntes =
    detalle.total_antes !== undefined ? Number(detalle.total_antes) : null
  const totalDespues =
    detalle.total_despues !== undefined ? Number(detalle.total_despues) : null

  const teniaFactura = !!detalle.tenia_factura_aprobada
  const facturaInfo = detalle.factura_info as
    | { numero?: number; tipo?: string; cae?: string; punto_venta?: number }
    | null
    | undefined

  const stockAjustes = Array.isArray(detalle.stock_ajustes)
    ? (detalle.stock_ajustes as StockAjuste[])
    : []

  // Lookup combinado para enriquecer ajustes de stock (despues pisa antes
  // porque refleja el estado mas reciente).
  const lookupVariantes = useMemo(() => {
    const m = new Map<string, ItemAuditado>()
    for (const it of itemsAntes) {
      if (it.variante_id) m.set(it.variante_id, it)
    }
    for (const it of itemsDespues) {
      if (it.variante_id) m.set(it.variante_id, it)
    }
    return m
  }, [itemsAntes, itemsDespues])

  return (
    <div className="space-y-3 text-xs">
      {accion === 'editar_venta' && teniaFactura && facturaInfo && (
        <div className="rounded border-2 border-dashed border-foreground/40 bg-muted/30 p-2 text-[11px]">
          <span className="font-medium">Factura emitida al editar: </span>
          <span className="font-numeric">
            {facturaInfo.tipo}
            {facturaInfo.numero !== undefined && ` #${facturaInfo.numero}`}
            {facturaInfo.cae && <> · CAE {facturaInfo.cae}</>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DiffColumna titulo="Antes" lado="antes" items={diff.antes} />
        <DiffColumna titulo="Después" lado="despues" items={diff.despues} />
      </div>

      <div className="rounded border bg-muted/30 p-2 space-y-1.5 text-[11px]">
        <DiffMonto
          label="Subtotal"
          antes={subtotalAntes}
          despues={subtotalDespues}
        />
        {totalAntes !== null && totalDespues !== null && (
          <DiffMonto
            label="Total"
            antes={totalAntes}
            despues={totalDespues}
            destacado
          />
        )}
      </div>

      {stockAjustes.length > 0 && (
        <StockAjustes ajustes={stockAjustes} lookup={lookupVariantes} />
      )}
    </div>
  )
}

// ---------- Diff monto ----------

function DiffMonto({
  label,
  antes,
  despues,
  destacado = false,
}: {
  label: string
  antes: number
  despues: number
  destacado?: boolean
}) {
  const delta = despues - antes
  const cambio = delta !== 0
  const signo = delta > 0 ? '+' : '−'

  return (
    <div className="flex items-center justify-between gap-2 font-numeric">
      <span
        className={cn(
          'text-muted-foreground',
          destacado && 'text-foreground font-medium'
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap justify-end">
        <span
          className={cn(
            'text-muted-foreground/70',
            cambio && 'line-through decoration-muted-foreground/50'
          )}
        >
          {formatARS(antes)}
        </span>
        <span aria-hidden className="text-muted-foreground/40">
          →
        </span>
        <span className={cn(destacado && 'font-semibold')}>
          {formatARS(despues)}
        </span>
        {cambio && (
          <span className="rounded border border-foreground/40 px-1 text-[10px]">
            {signo}
            {formatARS(Math.abs(delta))}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------- Diff columna items ----------

function DiffColumna({
  titulo,
  lado,
  items,
}: {
  titulo: string
  lado: 'antes' | 'despues'
  items: ItemDiff[]
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">
        {titulo}{' '}
        <span className="font-numeric text-muted-foreground/70">
          ({items.length})
        </span>
      </p>
      <div className="rounded border max-h-48 overflow-auto no-scrollbar">
        {items.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic p-2">
            Sin items
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((d, i) => (
              <ItemDiffRow key={i} diff={d} lado={lado} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ItemDiffRow({
  diff,
  lado,
}: {
  diff: ItemDiff
  lado: 'antes' | 'despues'
}) {
  const { item, estado, cantidadOpuesta } = diff
  const eliminado = estado === 'eliminado'
  const agregado = estado === 'agregado'
  const modificado = estado === 'modificado'

  return (
    <li
      className={cn(
        'text-[11px] p-2 flex items-start justify-between gap-2 border-l-2',
        agregado && 'border-l-foreground bg-muted/60',
        eliminado && 'border-l-foreground/60 bg-muted/30',
        modificado && 'border-l-foreground/40',
        !agregado && !eliminado && !modificado && 'border-l-transparent'
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'font-medium truncate',
            eliminado && 'line-through text-muted-foreground'
          )}
        >
          {item.producto_nombre ?? '—'}
        </p>
        <p
          className={cn(
            'text-muted-foreground font-numeric truncate',
            eliminado && 'line-through'
          )}
        >
          {descripcionVariante(item)}
          {item.variante_sku && ` · ${item.variante_sku}`}
        </p>
        {(agregado || eliminado || modificado) && (
          <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground font-numeric">
            {agregado && 'Nuevo'}
            {eliminado && 'Eliminado'}
            {modificado &&
              cantidadOpuesta !== undefined &&
              (lado === 'despues' ? (
                <>
                  Cantidad {cantidadOpuesta} → {item.cantidad ?? 0}
                </>
              ) : (
                <>
                  Cantidad {item.cantidad ?? 0} → {cantidadOpuesta}
                </>
              ))}
          </p>
        )}
      </div>
      <p
        className={cn(
          'font-numeric font-medium shrink-0',
          eliminado && 'line-through text-muted-foreground'
        )}
      >
        ×{item.cantidad ?? 0}
      </p>
    </li>
  )
}

// ---------- Ajustes de stock ----------

function StockAjustes({
  ajustes,
  lookup,
}: {
  ajustes: StockAjuste[]
  lookup: Map<string, ItemAuditado>
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">
        Ajustes de stock{' '}
        <span className="font-numeric text-muted-foreground/70">
          ({ajustes.length})
        </span>
      </p>
      <ul className="space-y-0.5">
        {ajustes.map((a, i) => {
          const delta = a.delta_aplicado ?? 0
          const signo = delta > 0 ? '+' : ''
          const info = a.variante_id ? lookup.get(a.variante_id) : undefined
          const nombre = info?.producto_nombre
          const desc = info ? descripcionVariante(info) : null
          const sku = info?.variante_sku

          return (
            <li
              key={i}
              className="text-[11px] flex items-center justify-between gap-2 rounded border px-2 py-1"
            >
              <div className="min-w-0 flex-1">
                {nombre ? (
                  <>
                    <p className="font-medium truncate">{nombre}</p>
                    <p className="text-muted-foreground font-numeric truncate">
                      {desc}
                      {sku && ` · ${sku}`}
                    </p>
                  </>
                ) : (
                  <p className="font-numeric truncate text-muted-foreground">
                    {a.variante_id ?? '—'}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  'font-numeric font-medium shrink-0 rounded border px-1.5 py-0.5',
                  delta > 0 && 'border-foreground/60',
                  delta < 0 && 'border-foreground/40 bg-muted/60',
                  delta === 0 && 'border-foreground/20 text-muted-foreground'
                )}
              >
                {signo}
                {delta}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
