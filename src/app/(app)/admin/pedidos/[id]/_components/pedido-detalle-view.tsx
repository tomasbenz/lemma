// src/app/(app)/admin/pedidos/[id]/_components/pedido-detalle-view.tsx
"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  FileText,
  Clock,
  AlertTriangle,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FechaRelativa } from "@/components/app/fecha-relativa";
import { formatARS } from "@/lib/format";
import {
  calcularDescuentoAplicado,
  calcularDescuentoDesdeMonto,
} from "@/lib/cobro/calculos";
import {
  finalizarPedido,
  type MedioPagoInput,
} from "../../_actions/finalizar-pedido";
import { AnularPedidoButton } from "./anular-pedido-button";
import { ItemsTable } from "./_items-table";
import { PanelFinalizar } from "./_panel-finalizar";
import { AsignarClienteInline } from "./asignar-cliente-inline";
import type { TipoFacturaUI as TipoFactura } from "@/lib/types/factura";
import type { MedioLinea, MedioPago } from "./_panel-medios-pago";
import type { PedidoDetalle } from "@/lib/queries/pedidos";
import type { ClienteCaja } from "@/lib/queries/clientes-caja";

function nuevoId() {
  return Math.random().toString(36).slice(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Props = {
  pedido: PedidoDetalle;
  clientes: ClienteCaja[];
  /**
   * Si false (vendedora), oculta el PanelFinalizar (cobro, factura,
   * descuentos, medios de pago) y muestra solo gestion: editar items,
   * asignar cliente, anular.
   */
  puedeFinalizar?: boolean;
};

export function PedidoDetalleView({
  pedido,
  clientes,
  puedeFinalizar = true,
}: Props) {
  const router = useRouter();

  // ============ Detección de problemas en items ============
  const problemasItems = useMemo(() => {
    return pedido.items.map((i) => {
      const problemas: string[] = [];
      if (!i.variante_activa) {
        problemas.push("Variante desactivada");
      }
      if (i.track_stock && i.cantidad > i.stock_actual) {
        problemas.push(
          `Stock insuficiente (disponible: ${i.stock_actual}, pedido: ${i.cantidad})`,
        );
      }
      return { item: i, problemas };
    });
  }, [pedido.items]);

  const hayProblemasCriticos = problemasItems.some(
    (p) => p.problemas.length > 0,
  );

  // ============ Cálculos de totales ============
  const subtotal = pedido.subtotal_neto;
  const [descuentoPct, setDescuentoPct] = useState<number | null>(null);
  const [descuentoMonto, setDescuentoMonto] = useState<number | null>(null);
  const [descuentoModo, setDescuentoModo] = useState<"porcentaje" | "monto">(
    "porcentaje",
  );
  const descuentoAplicado = useMemo(
    () =>
      descuentoModo === "porcentaje"
        ? calcularDescuentoAplicado(subtotal, descuentoPct)
        : calcularDescuentoDesdeMonto(subtotal, descuentoMonto),
    [subtotal, descuentoPct, descuentoMonto, descuentoModo],
  );
  const totalNeto = Math.max(0, subtotal - descuentoAplicado);

  // ============ Estado del panel de finalización ============
  const [clienteId, setClienteId] = useState<string | null>(
    pedido.cliente?.id ?? null,
  );
  const [tipoFactura, setTipoFactura] = useState<TipoFactura>("sin_factura");
  const [recargoFacturaCompleta, setRecargoFacturaCompleta] = useState(false);
  const [recargoManualPorcentaje, setRecargoManualPorcentaje] = useState<
    number | null
  >(null);
  const [recargoManualMotivo, setRecargoManualMotivo] = useState("");
  const [mostrarRecargoManual, setMostrarRecargoManual] = useState(false);

  // Total a cobrar. Prioridad: 10,5% > manual > sin recargo.
  const totalACobrar = recargoFacturaCompleta
    ? round2(totalNeto * 1.105)
    : recargoManualPorcentaje !== null
    ? round2(totalNeto * (1 + recargoManualPorcentaje / 100))
    : totalNeto;
  const recargoMonto = recargoFacturaCompleta
    ? round2(totalACobrar - totalNeto)
    : 0;
  const recargoManualMonto =
    recargoManualPorcentaje !== null
      ? round2(totalNeto * (recargoManualPorcentaje / 100))
      : 0;

  const [montoFacturado, setMontoFacturado] = useState<number | null>(0);
  const [medios, setMedios] = useState<MedioLinea[]>([
    {
      id: nuevoId(),
      medio: "efectivo" as MedioPago,
      monto: totalNeto,
      referencia: "",
    },
  ]);
  const [notaInterna, setNotaInterna] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Si cambia tipoFactura a sin_factura, apagar recargo y resetear monto
  useEffect(() => {
    if (tipoFactura === "sin_factura") {
      if (recargoFacturaCompleta) setRecargoFacturaCompleta(false);
      if ((montoFacturado ?? 0) !== 0) setMontoFacturado(0);
    } else {
      // Si activó factura por primera vez (monto en 0), default a 100% del total cobrado
      if ((montoFacturado ?? 0) === 0) {
        setMontoFacturado(totalACobrar);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoFactura]);

  // Cualquier cambio en cualquiera de los 2 recargos re-sincroniza el monto
  // facturado al nuevo total a cobrar. Crítico fiscal: previene que se cobre
  // con recargo aplicado pero se facture solo el neto, dejando desfase entre
  // ventas.total y ventas.monto_facturado (lo que se envía a AFIP).
  useEffect(() => {
    if (tipoFactura === "sin_factura") return;
    setMontoFacturado(totalACobrar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargoFacturaCompleta, recargoManualPorcentaje]);

  // Re-sincronizar montos cuando cambia el total a cobrar (descuento o recargo)
  useEffect(() => {
    setMedios((prev) => {
      if (prev.length === 1) {
        // Un solo medio: absorbe el total entero
        return [{ ...prev[0], monto: round2(totalACobrar) }];
      }
      // Múltiples medios: el último absorbe el saldo restante
      const sumaSinUltimo = prev
        .slice(0, -1)
        .reduce((acc, m) => acc + (m.monto ?? 0), 0);
      const restante = Math.max(0, totalACobrar - sumaSinUltimo);
      return prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, monto: round2(restante) } : m,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalACobrar]);

  const sumaMedios = medios.reduce((acc, m) => acc + (m.monto ?? 0), 0);
  const diferencia = totalACobrar - sumaMedios;
  const saldoOk = Math.abs(diferencia) < 0.01;

  // ============ Callbacks de medios de pago ============
  const agregarMedio = useCallback(() => {
    setMedios((prev) => {
      const sumaActual = prev.reduce((acc, m) => acc + (m.monto ?? 0), 0);
      const restante = totalACobrar - sumaActual;
      const montoNuevo = restante > 0.01 ? round2(restante) : null;

      return [
        ...prev,
        {
          id: nuevoId(),
          medio: "efectivo",
          monto: montoNuevo,
          referencia: "",
        },
      ];
    });
  }, [totalACobrar]);

  const removerMedio = useCallback(
    (id: string) => {
      setMedios((prev) => {
        if (prev.length <= 1) return prev;
        const filtrados = prev.filter((m) => m.id !== id);

        const sumaSinUltimo = filtrados
          .slice(0, -1)
          .reduce((acc, m) => acc + (m.monto ?? 0), 0);
        const restante = Math.max(0, totalACobrar - sumaSinUltimo);

        return filtrados.map((m, i) =>
          i === filtrados.length - 1 ? { ...m, monto: round2(restante) } : m,
        );
      });
    },
    [totalACobrar],
  );

  const actualizarMedio = useCallback(
    (id: string, patch: Partial<Omit<MedioLinea, "id">>) => {
      setMedios((prev) => {
        const actualizada = prev.map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        );

        if (patch.monto === undefined || prev.length < 2) {
          return actualizada;
        }

        const ultimoIdx = actualizada.length - 1;
        const editadoIdx = actualizada.findIndex((m) => m.id === id);
        const idxRebalanceo = editadoIdx === ultimoIdx ? 0 : ultimoIdx;

        const sumaOtros = actualizada.reduce(
          (acc, m, i) => acc + (i === idxRebalanceo ? 0 : (m.monto ?? 0)),
          0,
        );
        const restante = Math.max(0, totalACobrar - sumaOtros);

        return actualizada.map((m, i) =>
          i === idxRebalanceo ? { ...m, monto: round2(restante) } : m,
        );
      });
    },
    [totalACobrar],
  );

  const aplicarRestoAUltimo = useCallback(() => {
    setMedios((prev) => {
      if (prev.length === 0) return prev;
      const restante =
        totalACobrar -
        prev.slice(0, -1).reduce((acc, m) => acc + (m.monto ?? 0), 0);
      const last = prev[prev.length - 1];
      return [
        ...prev.slice(0, -1),
        { ...last, monto: round2(Math.max(0, restante)) },
      ];
    });
  }, [totalACobrar]);

  const completarSaldoEnLinea = useCallback(
    (id: string) => {
      setMedios((prev) => {
        const sumaOtras = prev.reduce((acc, m) => {
          if (m.id === id) return acc;
          return acc + (m.monto ?? 0);
        }, 0);
        const restante = Math.max(0, totalACobrar - sumaOtras);
        return prev.map((m) =>
          m.id === id ? { ...m, monto: round2(restante) } : m,
        );
      });
    },
    [totalACobrar],
  );

  // ============ Handler de submit ============
  async function handleFinalizar() {
    if (hayProblemasCriticos) {
      toast.error(
        "El pedido tiene problemas (stock o variantes) que hay que resolver antes de finalizar",
      );
      return;
    }

    if (!saldoOk) {
      toast.error(
        diferencia > 0
          ? `Faltan ${formatARS(diferencia)} para cubrir el total`
          : `Sobran ${formatARS(-diferencia)} en los medios de pago`,
      );
      return;
    }

    const mediosRpc: MedioPagoInput[] = medios
      .filter((m) => m.monto !== null && m.monto > 0)
      .map((m) => ({
        medio: m.medio,
        monto: m.monto as number,
        referencia: m.referencia.trim() || undefined,
      }));

    if (mediosRpc.length === 0) {
      toast.error("Ingresá al menos un medio de pago con monto");
      return;
    }

    const montoFactFinal =
      tipoFactura === "sin_factura" ? 0 : (montoFacturado ?? 0);

    setSubmitting(true);

    const result = await finalizarPedido({
      pedidoId: pedido.id,
      clienteId,
      mediosPago: mediosRpc,
      descuentoTotal: descuentoAplicado,
      tipoFactura,
      montoFacturado: montoFactFinal,
      recargoFacturaCompleta,
      recargoPorcentajeManual: recargoManualPorcentaje,
      recargoMotivo: recargoManualMotivo.trim() || undefined,
      notaInterna: notaInterna.trim() || (pedido.nota_interna ?? undefined),
    });

    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      `Pedido #${pedido.numero} finalizado como venta #${result.numero}`,
    );
    router.push(`/admin/ventas/${result.ventaId}`);
  }

  // ============ Render ============
  return (
    <div className="flex-1 p-3 md:p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Back */}
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/pedidos">
              <ArrowLeft className="size-4 mr-1" />
              Volver a pedidos
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-numeric">
                Pedido #{pedido.numero}
              </h1>
              <Badge
                variant="outline"
                className="text-xs text-warning border-warning/40 bg-warning/5"
              >
                <span className="size-1.5 rounded-full bg-warning mr-1.5" />
                Pendiente
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <Clock className="size-3.5" />
              <FechaRelativa
                fecha={pedido.created_at}
                larga
                className="font-numeric"
              />
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {pedido.estado === "guardada" && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/pedidos/${pedido.id}/editar`}>
                  <Pencil className="size-4 mr-1.5" />
                  Editar pedido
                </Link>
              </Button>
            )}
            <AnularPedidoButton pedidoId={pedido.id} numero={pedido.numero} />
          </div>
        </div>

        {/* Aviso si hay problemas */}
        {hayProblemasCriticos && (
          <Card className="border-destructive/40 bg-destructive/5 surface-1 enter-up">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-destructive">
                  Hay problemas con este pedido
                </p>
                <p className="text-muted-foreground mt-1">
                  Algunos items tienen stock insuficiente o variantes
                  desactivadas. No vas a poder finalizarlo hasta resolverlos.
                  Podés anular el pedido o contactar al cliente.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grid: izquierda info+items / derecha panel finalizar.
            Sin panel finalizar (vendedora), columnas full-width. */}
        <div
          className={
            puedeFinalizar
              ? "grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start"
              : "grid grid-cols-1 gap-4 items-start"
          }
        >
          {/* IZQUIERDA */}
          <div
            className={
              puedeFinalizar
                ? "lg:col-span-7 space-y-4 min-w-0"
                : "space-y-4 min-w-0"
            }
          >
            <DatosPedidoCard
              pedido={pedido}
              clientes={!puedeFinalizar ? clientes : undefined}
            />
            <ItemsTable items={problemasItems} />
          </div>

          {/* DERECHA (solo si puede finalizar) */}
          {puedeFinalizar && (
          <div className="lg:col-span-5 min-w-0">
            <PanelFinalizar
              subtotal={subtotal}
              descuentoAplicado={descuentoAplicado}
              totalNeto={totalNeto}
              totalACobrar={totalACobrar}
              recargoMonto={recargoMonto}
              diferencia={diferencia}
              saldoOk={saldoOk}
              clientes={clientes}
              clienteId={clienteId}
              setClienteId={setClienteId}
              descuentoPct={descuentoPct}
              setDescuentoPct={setDescuentoPct}
              descuentoMonto={descuentoMonto}
              setDescuentoMonto={setDescuentoMonto}
              descuentoModo={descuentoModo}
              setDescuentoModo={setDescuentoModo}
              tipoFactura={tipoFactura}
              setTipoFactura={setTipoFactura}
              montoFacturado={montoFacturado}
              setMontoFacturado={setMontoFacturado}
              recargoFacturaCompleta={recargoFacturaCompleta}
              setRecargoFacturaCompleta={setRecargoFacturaCompleta}
              medios={medios}
              agregarMedio={agregarMedio}
              actualizarMedio={actualizarMedio}
              removerMedio={removerMedio}
              aplicarRestoAUltimo={aplicarRestoAUltimo}
              completarSaldoEnLinea={completarSaldoEnLinea}
              notaInterna={notaInterna}
              setNotaInterna={setNotaInterna}
              recargoManualPorcentaje={recargoManualPorcentaje}
              setRecargoManualPorcentaje={setRecargoManualPorcentaje}
              recargoManualMotivo={recargoManualMotivo}
              setRecargoManualMotivo={setRecargoManualMotivo}
              mostrarRecargoManual={mostrarRecargoManual}
              setMostrarRecargoManual={setMostrarRecargoManual}
              recargoManualMonto={recargoManualMonto}
              submitting={submitting}
              hayProblemasCriticos={hayProblemasCriticos}
              onFinalizar={handleFinalizar}
            />
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Sub-componente: Card de datos del pedido ============

function DatosPedidoCard({
  pedido,
  clientes,
}: {
  pedido: PedidoDetalle;
  /**
   * Si esta presente, renderiza un selector inline para asignar/cambiar
   * cliente. Se usa solo en la vista de vendedora (sin PanelFinalizar).
   */
  clientes?: ClienteCaja[];
}) {
  return (
    <Card className="surface-1 enter-up">
      <CardHeader>
        <CardTitle className="text-base">Datos del pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataRow
          icon={<User className="size-4 text-muted-foreground" />}
          label="Vendedora"
        >
          <span className="text-sm">
            {pedido.vendedor?.nombre_completo ?? pedido.vendedor?.email ?? "—"}
          </span>
        </DataRow>

        <DataRow
          icon={<FileText className="size-4 text-muted-foreground" />}
          label="Cliente original"
        >
          {pedido.nombre_cliente_custom ? (
            <div className="text-sm">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-medium">{pedido.nombre_cliente_custom}</p>
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 px-1.5 h-4 font-normal text-muted-foreground"
                >
                  alias
                </Badge>
              </div>
              {pedido.cliente ? (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cliente real: {pedido.cliente.razon_social}
                  {pedido.cliente.cuit && ` · CUIT ${pedido.cliente.cuit}`}
                  {" · "}
                  {pedido.cliente.cond_iva}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sin cliente asignado
                </p>
              )}
            </div>
          ) : pedido.cliente ? (
            <div className="text-sm">
              <p className="font-medium">{pedido.cliente.razon_social}</p>
              <p className="text-xs text-muted-foreground">
                {pedido.cliente.cuit && `CUIT ${pedido.cliente.cuit} · `}
                {pedido.cliente.cond_iva}
              </p>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground italic">
              Sin cliente asignado
            </span>
          )}
        </DataRow>

        {pedido.nota_interna && (
          <DataRow
            icon={<MoreHorizontal className="size-4 text-muted-foreground" />}
            label="Nota de la vendedora"
          >
            <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded-md p-2 border">
              {pedido.nota_interna}
            </p>
          </DataRow>
        )}

        {clientes && (
          <DataRow
            icon={<User className="size-4 text-muted-foreground" />}
            label="Asignar / cambiar cliente"
          >
            <AsignarClienteInline
              pedidoId={pedido.id}
              clientes={clientes}
              clienteIdActual={pedido.cliente?.id ?? null}
            />
          </DataRow>
        )}
      </CardContent>
    </Card>
  );
}

function DataRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <div>{children}</div>
      </div>
    </div>
  );
}
