// src/app/(app)/admin/_components/dashboard-view.tsx
'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bell,
  Inbox,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
  Receipt,
  BarChart3,
  CheckCheck,
  ArrowRight,
  Clock,
  User,
  FileText,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FechaRelativa } from '@/components/app/fecha-relativa'
import { SaludoDashboard } from './saludo-dashboard'
import { formatARS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { marcarTodosPedidosVistos } from '../pedidos/_actions/marcar-pedido-visto'
import type { CurrentUser } from '@/lib/auth/get-current-user'
import type { DashboardStats, PedidoBandeja } from '@/lib/queries/dashboard'

type Props = {
  user: CurrentUser
  stats: DashboardStats
}

export function DashboardView({ user, stats }: Props) {
  const router = useRouter()
  const [marcando, startMarcando] = useTransition()

  const {
    pedidosNuevos,
    pedidosVistos,
    ventasHoy,
    montoHoy,
    ventasMes,
    montoMes,
    montoMesAnterior,
    productosStockBajo,
    productosSinStock,
  } = stats

  const totalPedidosPendientes = pedidosNuevos.length + pedidosVistos.length
  const stockCritico = productosStockBajo + productosSinStock
  const variacionMontoMes =
    montoMesAnterior > 0
      ? ((montoMes - montoMesAnterior) / montoMesAnterior) * 100
      : null

  function handleMarcarTodos() {
    startMarcando(async () => {
      const result = await marcarTodosPedidosVistos()
      if (!result.ok) {
        toast.error(result.error ?? 'Error al marcar como vistos')
        return
      }
      toast.success(
        `${result.cantidad} ${result.cantidad === 1 ? 'pedido marcado' : 'pedidos marcados'} como vistos`
      )
      router.refresh()
    })
  }

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Saludo din mico */}
        <SaludoDashboard nombre={user.nombre_completo} />

        {/* ============ BANNER PEDIDOS NUEVOS ============ */}
        {pedidosNuevos.length > 0 && (
          <BannerNuevos
            cantidad={pedidosNuevos.length}
            onMarcarTodos={handleMarcarTodos}
            marcando={marcando}
          />
        )}

        {/* ============ BANDEJA PEDIDOS ============ */}
        {totalPedidosPendientes > 0 ? (
          <div className="space-y-4">
            {pedidosNuevos.length > 0 && (
              <SeccionPedidos
                titulo="Nuevos"
                cantidad={pedidosNuevos.length}
                pedidos={pedidosNuevos}
                tipo="nuevo"
              />
            )}
            {pedidosVistos.length > 0 && (
              <SeccionPedidos
                titulo="Ya vistos"
                cantidad={pedidosVistos.length}
                pedidos={pedidosVistos}
                tipo="visto"
              />
            )}
            {totalPedidosPendientes > 0 && (
              <div className="flex justify-end">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/admin/pedidos">
                    Ver todos los pedidos
                    <ArrowRight className="size-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card className="p-8 text-center border-dashed">
            <div className="flex flex-col items-center gap-2">
              <div className="size-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCheck className="size-6 text-success" />
              </div>
              <p className="text-sm font-medium">
                No hay pedidos pendientes
              </p>
              <p className="text-xs text-muted-foreground">
                Cuando las vendedoras guarden pedidos los vas a ver acá.
              </p>
            </div>
          </Card>
        )}

        <Separator />

        {/* ============ KPIs ============ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Hoy */}
          <KpiCard
            label="Hoy"
            valorPrincipal={formatARS(montoHoy)}
            valorSecundario={`${ventasHoy} ${ventasHoy === 1 ? 'venta' : 'ventas'}`}
            href="/admin/ventas"
          />

          {/* Stock crítico */}
          <KpiCard
            label="Stock"
            valorPrincipal={
              stockCritico > 0
                ? `${stockCritico} ${stockCritico === 1 ? 'producto' : 'productos'}`
                : 'Todo OK'
            }
            valorSecundario={
              stockCritico > 0
                ? `${productosSinStock} sin stock · ${productosStockBajo} bajos`
                : 'Sin alertas de stock'
            }
            warning={stockCritico > 0}
            warningIcon={
              productosSinStock > 0 ? <AlertTriangle /> : undefined
            }
            href="/admin/productos"
          />

          {/* Mes */}
          <KpiCard
            label="Mes"
            valorPrincipal={formatARS(montoMes)}
            valorSecundario={`${ventasMes} ${ventasMes === 1 ? 'venta' : 'ventas'}`}
            tendencia={variacionMontoMes}
            tendenciaLabel="vs mes anterior"
            href="/admin/reportes"
          />
        </div>

        {/* ============ ACCIONES RÁPIDAS ============ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <AccionRapida href="/caja" icon={<ShoppingCart />} label="Caja" />
          <AccionRapida
            href="/admin/pedidos"
            icon={<Inbox />}
            label="Pedidos"
            badge={totalPedidosPendientes}
          />
          <AccionRapida
            href="/admin/ventas"
            icon={<Receipt />}
            label="Ventas"
          />
          <AccionRapida
            href="/admin/reportes"
            icon={<BarChart3 />}
            label="Reportes"
          />
        </div>
      </div>
    </div>
  )
}

// ============ Banner pedidos nuevos ============

function BannerNuevos({
  cantidad,
  onMarcarTodos,
  marcando,
}: {
  cantidad: number
  onMarcarTodos: () => void
  marcando: boolean
}) {
  return (
    <Card
      className={cn(
        'p-4 border-warning/40 bg-warning/5 surface-2',
        'enter-up'
      )}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="size-9 rounded-md bg-warning/15 flex items-center justify-center shrink-0">
          <Bell className="size-4 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            Tenés{' '}
            <span className="text-warning font-bold font-numeric">
              {cantidad}
            </span>{' '}
            {cantidad === 1 ? 'pedido nuevo' : 'pedidos nuevos'} esperando
          </p>
          <p className="text-xs text-muted-foreground">
            Revisalos y finalizá los que están listos para cobrar.
          </p>
        </div>
        {cantidad > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarcarTodos}
            disabled={marcando}
            className="shrink-0"
          >
            {marcando ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCheck className="size-3.5 mr-1.5" />
            )}
            Marcar todos como vistos
          </Button>
        )}
      </div>
    </Card>
  )
}

// ============ Sección de pedidos (Nuevos / Ya vistos) ============

function SeccionPedidos({
  titulo,
  cantidad,
  pedidos,
  tipo,
}: {
  titulo: string
  cantidad: number
  pedidos: PedidoBandeja[]
  tipo: 'nuevo' | 'visto'
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {titulo}
        </h2>
        <span className="text-xs font-numeric text-muted-foreground">
          ({cantidad})
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {pedidos.map((p, i) => (
          <PedidoBandejaCard key={p.id} pedido={p} tipo={tipo} index={i} />
        ))}
      </div>
    </div>
  )
}

// ============ Card de pedido ============

function PedidoBandejaCard({
  pedido,
  tipo,
  index,
}: {
  pedido: PedidoBandeja
  tipo: 'nuevo' | 'visto'
  index: number
}) {
  // Pedido pendiente: el subtotal_neto ya es lo que va a pagar el cliente
  // (el recargo opcional 10,5% se aplica al finalizar el pedido, no acá).
  const totalEstimado = pedido.subtotal_neto
  const esNuevo = tipo === 'nuevo'

  return (
    <Link href={`/admin/pedidos/${pedido.id}`} className="block">
      <Card
        interactive
        className={cn(
          'p-3 relative',
          esNuevo && [
            'border-l-4 border-l-warning',
            'bg-warning/5',
            'enter-up',
          ],
          !esNuevo && 'opacity-90'
        )}
        style={
          esNuevo ? { animationDelay: `${index * 60}ms` } : undefined
        }
      >
        {/* Punto pulsante para nuevos */}
        {esNuevo && (
          <span className="absolute top-3 right-3 size-2 rounded-full bg-warning animate-pulse" />
        )}

        <div className="flex items-start gap-3">
          <div
            className={cn(
              'size-9 rounded-md flex items-center justify-center shrink-0',
              esNuevo ? 'bg-warning/15' : 'bg-muted'
            )}
          >
            <Package
              className={cn(
                'size-4',
                esNuevo ? 'text-warning' : 'text-muted-foreground'
              )}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-numeric font-bold text-sm">
                #{pedido.numero}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="size-3" />
                <FechaRelativa fecha={pedido.created_at} className="font-numeric" />
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <User className="size-3" />
                <span className="truncate max-w-[120px]">
                  {pedido.vendedor_nombre}
                </span>
              </span>
              {pedido.cliente_nombre && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <FileText className="size-3" />
                  <span className="truncate max-w-[120px]">
                    {pedido.cliente_nombre}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="font-numeric font-semibold text-sm">
              {formatARS(totalEstimado)}
            </p>
            <p className="text-[10px] text-muted-foreground font-numeric">
              {pedido.items_count}{' '}
              {pedido.items_count === 1 ? 'ítem' : 'ítems'}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  )
}

// ============ KPI card ============

function KpiCard({
  label,
  valorPrincipal,
  valorSecundario,
  tendencia,
  tendenciaLabel,
  warning,
  warningIcon,
  href,
}: {
  label: string
  valorPrincipal: string
  valorSecundario: string
  tendencia?: number | null
  tendenciaLabel?: string
  warning?: boolean
  warningIcon?: React.ReactNode
  href: string
}) {
  return (
    <Link href={href} className="block">
      <Card
        interactive
        className={cn(
          'p-4 h-full',
          warning && 'border-warning/40 bg-warning/5'
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {warning && warningIcon && (
            <span className="text-warning [&>svg]:size-4">{warningIcon}</span>
          )}
        </div>
        <p className="text-2xl font-bold font-numeric mt-2">
          {valorPrincipal}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {valorSecundario}
        </p>
        {tendencia !== null && tendencia !== undefined && tendenciaLabel && (
          <div
            className={cn(
              'mt-2 flex items-center gap-1 text-xs font-medium',
              tendencia > 5
                ? 'text-success'
                : tendencia < -5
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            )}
          >
            {tendencia > 0 ? (
              <TrendingUp className="size-3" />
            ) : (
              <TrendingDown className="size-3" />
            )}
            <span className="font-numeric">
              {tendencia > 0 ? '+' : ''}
              {tendencia.toFixed(1)}%
            </span>
            <span className="text-muted-foreground font-normal">
              {tendenciaLabel}
            </span>
          </div>
        )}
      </Card>
    </Link>
  )
}

// ============ Acción rápida ============

function AccionRapida({
  href,
  icon,
  label,
  badge,
}: {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <Link href={href} className="block">
      <Card
        interactive
        className="p-3 flex flex-row items-center gap-2 relative"
      >
        <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold font-numeric">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Card>
    </Link>
  )
}