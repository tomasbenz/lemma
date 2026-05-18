"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Banknote,
  ArrowRightLeft,
  Building2,
  CreditCard,
  Plus,
  Trash2,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { NumericInput } from "@/components/app/numeric-input";
import { cn } from "@/lib/utils";
import { formatARS } from "@/lib/format";
import { selectAllOnFocus } from "@/lib/utils/select-all-on-focus";
import { SelectorCliente } from "./selector-cliente";
import { RecargoManualForm } from "@/components/app/recargo-manual-form";
import {
  cerrarVenta,
  type ItemVentaInput,
  type MedioPagoInput,
} from "../_actions/cerrar-venta";
import type { ItemCarrito } from "../_hooks/use-carrito";
import type { DescuentoModo } from "../_hooks/use-carrito";
import type { ClienteCaja } from "@/lib/queries/clientes-caja";
import type { TipoFacturaUI as TipoFactura } from "@/lib/types/factura";
type MedioPago = "efectivo" | "transferencia" | "deposito" | "tarjeta_credito";

type MedioLinea = {
  id: string;
  medio: MedioPago;
  monto: number | null;
  referencia: string;
};

type ModalCobroProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemCarrito[];
  clientes: ClienteCaja[];
  clienteId: string | null;
  onClienteChange: (id: string | null) => void;
  subtotal: number;
  descuentoAplicado: number;
  total: number; // total neto (subtotal - descuento)
  /**
   * Descuento editable desde el modal. El modal lee/escribe directamente al
   * estado del carrito vía estos cuatro props para que el descuento persista
   * si la cajera cierra el modal sin confirmar (el descuento es propiedad
   * de la venta pre-cierre, no del modal).
   */
  descuentoValor: number;
  descuentoModo: DescuentoModo;
  onDescuentoValorChange: (v: number) => void;
  onDescuentoModoChange: (m: DescuentoModo) => void;
  /**
   * empresas.features.recargo_manual_habilitado. Controla:
   *   - Sección "Recargo manual (opcional)" con botón "+ Aplicar recargo manual".
   *   - Presets 30/50/100 de "Monto a facturar".
   *   - Input numérico libre de "Monto a facturar".
   * Cuando false, el input de monto a facturar queda disabled y fijo en el
   * total a cobrar (no se soporta facturación parcial).
   */
  recargoManualHabilitado: boolean;
  /**
   * empresas.features.recargo_105_habilitado. Controla SOLO el checkbox
   * "Cobrar 10,5% extra al cliente" y el bloque de resumen "Recargo 10,5%".
   * Independiente del recargo manual. Default false para Samu (boletas
   * simples sin split fiscal).
   */
  recargo105Habilitado: boolean;
  onVentaCerrada: (ventaId: string, numero: number) => void;
};

const MEDIOS_INFO: Record<MedioPago, { label: string; icon: React.ReactNode }> =
  {
    efectivo: { label: "Efectivo", icon: <Banknote className="size-4" /> },
    transferencia: {
      label: "Transferencia",
      icon: <ArrowRightLeft className="size-4" />,
    },
    deposito: { label: "Depósito", icon: <Building2 className="size-4" /> },
    tarjeta_credito: {
      label: "Tarjeta crédito",
      icon: <CreditCard className="size-4" />,
    },
  };

// Porcentajes preset para "Monto a facturar" cuando se factura parcial.
// Disponibles solo cuando recargoManualHabilitado=true (Samu lo necesita).
const PORCENTAJES_PRESET = [30, 50, 100] as const;

function nuevoId() {
  return Math.random().toString(36).slice(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ModalCobro({
  open,
  onOpenChange,
  items,
  clientes,
  clienteId,
  onClienteChange,
  subtotal,
  descuentoAplicado,
  total, // total neto
  descuentoValor,
  descuentoModo,
  onDescuentoValorChange,
  onDescuentoModoChange,
  recargoManualHabilitado,
  recargo105Habilitado,
  onVentaCerrada,
}: ModalCobroProps) {
  const [tipoFactura, setTipoFactura] = useState<TipoFactura>("sin_factura");
  const [montoFacturado, setMontoFacturado] = useState<number | null>(0);
  const [recargoFacturaCompleta, setRecargoFacturaCompleta] = useState(false);
  const [recargoManualPorcentaje, setRecargoManualPorcentaje] = useState<
    number | null
  >(null);
  const [recargoManualMotivo, setRecargoManualMotivo] = useState("");
  const [mostrarRecargoManual, setMostrarRecargoManual] = useState(false);
  const [medios, setMedios] = useState<MedioLinea[]>([
    { id: nuevoId(), medio: "efectivo", monto: null, referencia: "" },
  ]);
  const [usuarioEditoMedios, setUsuarioEditoMedios] = useState(false);
  const [notaInterna, setNotaInterna] = useState("");
  const [nombreClienteCustom, setNombreClienteCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Total a cobrar. Prioridad: 10,5% > manual > sin recargo.
  const totalACobrar = useMemo(() => {
    if (recargoFacturaCompleta) return round2(total * 1.105);
    if (recargoManualPorcentaje !== null) {
      return round2(total * (1 + recargoManualPorcentaje / 100));
    }
    return total;
  }, [total, recargoFacturaCompleta, recargoManualPorcentaje]);

  const recargoManualMonto = useMemo(() => {
    if (recargoManualPorcentaje === null) return 0;
    return round2(total * (recargoManualPorcentaje / 100));
  }, [total, recargoManualPorcentaje]);

  // Recargo 10,5% desactiva si cambia tipo a sin_factura
  useEffect(() => {
    if (tipoFactura === "sin_factura" && recargoFacturaCompleta) {
      setRecargoFacturaCompleta(false);
    }
  }, [tipoFactura, recargoFacturaCompleta]);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setTipoFactura("sin_factura");
      setMontoFacturado(0);
      setRecargoFacturaCompleta(false);
      setRecargoManualPorcentaje(null);
      setRecargoManualMotivo("");
      setMostrarRecargoManual(false);
      setUsuarioEditoMedios(false);
      setMedios([
        {
          id: nuevoId(),
          medio: "efectivo",
          monto: totalACobrar,
          referencia: "",
        },
      ]);
      setNotaInterna("");
      setNombreClienteCustom("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-sync del medio único al totalACobrar mientras la cajera no haya
  // editado manualmente.
  useEffect(() => {
    if (usuarioEditoMedios) return;
    setMedios((prev) => {
      if (prev.length !== 1) return prev;
      return [{ ...prev[0], monto: totalACobrar }];
    });
  }, [totalACobrar, usuarioEditoMedios]);

  // Cambios en los recargos re-sincronizan monto facturado al total a cobrar.
  // Crítico fiscal: previene desfase entre ventas.total y ventas.monto_facturado.
  useEffect(() => {
    if (tipoFactura === "sin_factura") return;
    setMontoFacturado(totalACobrar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recargoFacturaCompleta, recargoManualPorcentaje]);

  // Default monto facturado al activar factura
  useEffect(() => {
    if (tipoFactura !== "sin_factura" && (montoFacturado ?? 0) === 0) {
      setMontoFacturado(totalACobrar);
    }
    if (tipoFactura === "sin_factura" && (montoFacturado ?? 0) !== 0) {
      setMontoFacturado(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoFactura]);

  const sumaMedios = useMemo(
    () => medios.reduce((acc, m) => acc + (m.monto ?? 0), 0),
    [medios],
  );
  const diferencia = totalACobrar - sumaMedios;
  const saldoOk = Math.abs(diferencia) < 0.01;

  // Detectar % preset activo (sobre el total cobrado, no sobre el neto)
  const porcentajeActivo = useMemo(() => {
    if (!montoFacturado || tipoFactura === "sin_factura") return null;
    for (const p of PORCENTAJES_PRESET) {
      const valorEsperado = round2(totalACobrar * (p / 100));
      if (Math.abs(montoFacturado - valorEsperado) < 0.01) return p;
    }
    return null;
  }, [montoFacturado, totalACobrar, tipoFactura]);

  const aplicarPorcentaje = useCallback(
    (porcentaje: number) => {
      if (
        (recargoFacturaCompleta || recargoManualPorcentaje !== null) &&
        porcentaje !== 100
      ) {
        toast.warning(
          "Con recargo aplicado solo se puede facturar el 100% del total",
        );
        return;
      }
      setMontoFacturado(round2(totalACobrar * (porcentaje / 100)));
    },
    [totalACobrar, recargoFacturaCompleta, recargoManualPorcentaje],
  );

  const agregarMedio = useCallback(() => {
    setMedios((prev) => {
      const sumaActual = prev.reduce((acc, m) => acc + (m.monto ?? 0), 0);
      const restante = round2(Math.max(0, totalACobrar - sumaActual));
      return [
        ...prev,
        {
          id: nuevoId(),
          medio: "efectivo" as MedioPago,
          monto: restante > 0 ? restante : null,
          referencia: "",
        },
      ];
    });
  }, [totalACobrar]);

  const removerMedio = useCallback((id: string) => {
    setMedios((prev) =>
      prev.length > 1 ? prev.filter((m) => m.id !== id) : prev,
    );
  }, []);

  const actualizarMedio = useCallback(
    (id: string, patch: Partial<Omit<MedioLinea, "id">>) => {
      setUsuarioEditoMedios(true);
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

  const recargoMonto = round2(totalACobrar - total);

  // Validación visual del descuento: el % > 100 o el monto > subtotal
  // son inválidos. useCarrito hace clamp también, pero queremos feedback.
  const descuentoInvalido = useMemo(() => {
    if (descuentoModo === "porcentaje") return descuentoValor > 100;
    return descuentoValor > subtotal;
  }, [descuentoValor, descuentoModo, subtotal]);

  async function handleConfirmar() {
    if (!saldoOk) {
      toast.error(
        diferencia > 0
          ? `Faltan ${formatARS(diferencia)} para cubrir el total`
          : `Sobran ${formatARS(-diferencia)} en los medios de pago`,
      );
      return;
    }

    const mediosConMonto = medios.filter(
      (m) => m.monto !== null && m.monto > 0,
    );
    if (mediosConMonto.length !== medios.length) {
      setMedios(mediosConMonto);
      if (mediosConMonto.length === 0) {
        toast.error("Ingresá al menos un medio de pago con monto > 0");
        return;
      }
      const sumaFiltrada = mediosConMonto.reduce(
        (acc, m) => acc + (m.monto ?? 0),
        0,
      );
      if (Math.abs(totalACobrar - sumaFiltrada) > 0.01) {
        toast.error(
          totalACobrar - sumaFiltrada > 0
            ? `Faltan ${formatARS(totalACobrar - sumaFiltrada)} para cubrir el total`
            : `Sobran ${formatARS(sumaFiltrada - totalACobrar)} en los medios de pago`,
        );
        return;
      }
    }

    const itemsRpc: ItemVentaInput[] = items.map((i) => ({
      varianteId: i.varianteId,
      productoNombre: i.productoNombre,
      productoSku: i.productoSku,
      skuVariante: i.skuVariante,
      atributos: i.atributos,
      cantidad: i.cantidad,
      precioUnitarioNeto: i.precioUnitarioNeto,
    }));

    const mediosRpc: MedioPagoInput[] = mediosConMonto.map((m) => ({
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

    const result = await cerrarVenta({
      clienteId,
      nombreClienteCustom: nombreClienteCustom.trim() || undefined,
      items: itemsRpc,
      mediosPago: mediosRpc,
      descuentoTotal: descuentoAplicado,
      tipoFactura,
      montoFacturado: montoFactFinal,
      recargoFacturaCompleta,
      recargoPorcentajeManual: recargoManualPorcentaje,
      recargoMotivo: recargoManualMotivo.trim() || undefined,
      notaInterna: notaInterna.trim() || undefined,
    });

    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      `Venta #${result.numero} cerrada por ${formatARS(totalACobrar)}`,
    );
    onVentaCerrada(result.ventaId, result.numero);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle>Cerrar venta</DialogTitle>
          <DialogDescription>
            {items.length} {items.length === 1 ? "ítem" : "ítems"} ·{" "}
            <span className="font-numeric font-medium text-foreground">
              {formatARS(totalACobrar)}
            </span>{" "}
            a cobrar
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-4 min-h-0 space-y-6 no-scrollbar">
          {/* RESUMEN DE TOTALES */}
          <div className="rounded-md border p-3 space-y-1.5 text-sm bg-muted/20">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal neto</span>
              <span className="font-numeric">{formatARS(subtotal)}</span>
            </div>
            {descuentoAplicado > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Descuento</span>
                <span className="font-numeric">
                  − {formatARS(descuentoAplicado)}
                </span>
              </div>
            )}
            {recargoFacturaCompleta && (
              <div className="flex justify-between text-muted-foreground">
                <span>Recargo 10,5%</span>
                <span className="font-numeric">
                  + {formatARS(recargoMonto)}
                </span>
              </div>
            )}
            {recargoManualPorcentaje !== null && recargoManualMonto > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Recargo {recargoManualPorcentaje}% manual</span>
                <span className="font-numeric">
                  + {formatARS(recargoManualMonto)}
                </span>
              </div>
            )}
            <Separator className="my-1.5" />
            <div className="flex justify-between text-base font-semibold">
              <span>Total a cobrar</span>
              <span className="font-numeric">{formatARS(totalACobrar)}</span>
            </div>
          </div>

          {/* CLIENTE */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Cliente</Label>
            <SelectorCliente
              clientes={clientes}
              clienteId={clienteId}
              onChange={onClienteChange}
            />

            <div className="pt-1">
              <Label
                htmlFor="nombre-cliente-custom"
                className="text-xs text-muted-foreground"
              >
                Nombre / referencia personalizada (opcional)
              </Label>
              <Input
                id="nombre-cliente-custom"
                value={nombreClienteCustom}
                onChange={(e) => setNombreClienteCustom(e.target.value)}
                onFocus={selectAllOnFocus}
                placeholder="Ej: TOMAS BENZ #32009"
                maxLength={100}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se va a mostrar en el listado de ventas y en el detalle.
              </p>
            </div>
          </div>

          {/* DESCUENTO (escribe al carrito vía callbacks) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="descuento-valor"
                className="text-sm font-medium"
              >
                Descuento (opcional)
              </Label>
              <div
                className="inline-flex rounded-md border overflow-hidden text-xs"
                role="tablist"
                aria-label="Modo de descuento"
              >
                {(["porcentaje", "monto"] as DescuentoModo[]).map((m) => {
                  const activo = descuentoModo === m;
                  const label = m === "porcentaje" ? "%" : "$";
                  return (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={activo}
                      onClick={() => onDescuentoModoChange(m)}
                      className={cn(
                        "px-2.5 py-1 font-numeric tabular-nums transition-colors",
                        activo
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <NumericInput
              id="descuento-valor"
              value={descuentoValor || null}
              onChange={(v) => onDescuentoValorChange(v ?? 0)}
              decimals={2}
              min={0}
              max={descuentoModo === "porcentaje" ? 100 : subtotal}
              allowEmpty
              prefix={descuentoModo === "monto" ? "$" : undefined}
              placeholder={descuentoModo === "porcentaje" ? "0" : "0,00"}
              className={cn(
                descuentoInvalido &&
                  "border-destructive focus-visible:ring-destructive/50",
              )}
            />

            {descuentoInvalido && (
              <p className="text-[10px] text-destructive">
                {descuentoModo === "porcentaje"
                  ? "El descuento no puede superar 100%"
                  : `El descuento no puede superar el subtotal (${formatARS(subtotal)})`}
              </p>
            )}

            {descuentoAplicado > 0 && !descuentoInvalido && (
              <p className="text-[10px] text-muted-foreground">
                Aplica {formatARS(descuentoAplicado)} sobre subtotal{" "}
                {formatARS(subtotal)}. Total neto: {formatARS(total)}.
              </p>
            )}
          </div>

          {/* RECARGO MANUAL — feature flag recargo_manual_habilitado */}
          {recargoManualHabilitado && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Recargo manual (opcional)
              </Label>
              {!mostrarRecargoManual ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={recargoFacturaCompleta}
                  onClick={() => {
                    setMostrarRecargoManual(true);
                    setRecargoManualPorcentaje(30);
                  }}
                  className="w-full justify-start text-muted-foreground"
                >
                  + Aplicar recargo manual (ej: 30% tarjeta)
                  {recargoFacturaCompleta && (
                    <span className="ml-auto text-[10px]">
                      (no disponible con recargo 10,5%)
                    </span>
                  )}
                </Button>
              ) : (
                <RecargoManualForm
                  porcentaje={recargoManualPorcentaje}
                  motivo={recargoManualMotivo}
                  onPorcentajeChange={setRecargoManualPorcentaje}
                  onMotivoChange={setRecargoManualMotivo}
                  onClose={() => {
                    setRecargoManualPorcentaje(null);
                    setRecargoManualMotivo("");
                    setMostrarRecargoManual(false);
                  }}
                />
              )}
            </div>
          )}

          {/* FACTURACIÓN */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Facturación</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["sin_factura", "con_factura"] as TipoFactura[]).map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => setTipoFactura(tipo)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-medium text-center",
                    tipoFactura === tipo
                      ? "border-foreground bg-muted"
                      : "border-border hover:border-foreground/40",
                  )}
                >
                  {tipo === "sin_factura" ? "Sin factura" : "Con factura"}
                </button>
              ))}
            </div>

            {tipoFactura !== "sin_factura" && (
              <div className="pt-2 space-y-3">
                {/* RECARGO 10,5% — feature flag recargo_105_habilitado */}
                {recargo105Habilitado && (
                  <label className="flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer hover:border-foreground/40">
                    <input
                      type="checkbox"
                      checked={recargoFacturaCompleta}
                      onChange={(e) => {
                        setRecargoFacturaCompleta(e.target.checked);
                        if (e.target.checked && recargoManualPorcentaje !== null) {
                          setRecargoManualPorcentaje(null);
                          setRecargoManualMotivo("");
                          setMostrarRecargoManual(false);
                          toast.warning(
                            "Se desactivó el recargo manual — solo se puede aplicar un tipo de recargo",
                          );
                        }
                      }}
                      className="mt-0.5 size-4 cursor-pointer"
                    />
                    <div className="flex-1 -mt-0.5">
                      <div className="text-sm font-medium">
                        Cobrar 10,5% extra al cliente
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        El cliente paga {formatARS(total)} +{" "}
                        {formatARS(round2(total * 0.105))} ={" "}
                        {formatARS(round2(total * 1.105))}. Se factura el 100%
                        por ese mismo monto.
                      </p>
                    </div>
                  </label>
                )}

                {/* MONTO A FACTURAR */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="monto-facturado"
                      className="text-xs text-muted-foreground"
                    >
                      Monto a facturar
                    </Label>
                    {recargoManualHabilitado && (
                      <div className="flex items-center gap-1">
                        {PORCENTAJES_PRESET.map((p) => {
                          const activo = porcentajeActivo === p;
                          const deshabilitado =
                            (recargoFacturaCompleta ||
                              recargoManualPorcentaje !== null) &&
                            p !== 100;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => aplicarPorcentaje(p)}
                              disabled={deshabilitado}
                              className={cn(
                                "rounded border px-2 py-0.5 text-[11px] font-medium font-numeric tabular-nums transition-colors",
                                activo
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                                deshabilitado &&
                                  "opacity-30 cursor-not-allowed hover:border-border hover:text-muted-foreground",
                              )}
                            >
                              {p}%
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <NumericInput
                    id="monto-facturado"
                    value={montoFacturado}
                    onChange={setMontoFacturado}
                    decimals={2}
                    min={0}
                    allowEmpty
                    prefix="$"
                    placeholder="0,00"
                    disabled={
                      !recargoManualHabilitado ||
                      recargoFacturaCompleta ||
                      recargoManualPorcentaje !== null
                    }
                  />

                  {recargoManualHabilitado &&
                    porcentajeActivo !== null &&
                    porcentajeActivo < 100 &&
                    !recargoFacturaCompleta && (
                      <p className="text-[10px] text-muted-foreground">
                        Facturando {porcentajeActivo}% del total ·{" "}
                        {formatARS(totalACobrar - (montoFacturado ?? 0))} sin
                        facturar
                      </p>
                    )}

                  {recargoManualHabilitado &&
                    (recargoFacturaCompleta ||
                      recargoManualPorcentaje !== null) && (
                      <p className="text-[10px] text-muted-foreground">
                        Con recargo se factura el 100% por{" "}
                        {formatARS(totalACobrar)}.
                      </p>
                    )}
                </div>
              </div>
            )}
          </div>

          {/* MEDIOS DE PAGO */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Medios de pago</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={agregarMedio}
                className="h-7"
              >
                <Plus className="size-3.5 mr-1" />
                Agregar
              </Button>
            </div>

            <div className="space-y-2">
              {medios.map((m) => {
                const montoLinea = m.monto ?? 0;
                const saldoDisponible = diferencia + montoLinea;
                return (
                  <LineaMedio
                    key={m.id}
                    linea={m}
                    onChange={(patch) => actualizarMedio(m.id, patch)}
                    onRemove={() => removerMedio(m.id)}
                    onCompletarSaldo={() => completarSaldoEnLinea(m.id)}
                    saldoDisponible={saldoDisponible}
                    puedeRemover={medios.length > 1}
                  />
                );
              })}
            </div>

            <div
              className={cn(
                "rounded-md border p-2.5 flex items-center justify-between text-sm mt-3",
                saldoOk
                  ? "border-success/40 bg-success/5 text-success"
                  : "border-warning/40 bg-warning/5",
              )}
            >
              <span className="font-medium">
                {saldoOk
                  ? "Saldo correcto"
                  : diferencia > 0
                    ? "Falta"
                    : "Sobra"}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-numeric font-semibold">
                  {saldoOk
                    ? formatARS(totalACobrar)
                    : formatARS(Math.abs(diferencia))}
                </span>
                {!saldoOk && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={aplicarRestoAUltimo}
                    className="h-7 text-xs"
                  >
                    Aplicar resto
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* NOTA INTERNA */}
          <div className="space-y-1.5">
            <Label
              htmlFor="nota-interna"
              className="text-xs text-muted-foreground"
            >
              Nota interna (opcional)
            </Label>
            <Input
              id="nota-interna"
              value={notaInterna}
              onChange={(e) => setNotaInterna(e.target.value)}
              onFocus={selectAllOnFocus}
              placeholder="Ej: cliente llevó pedido a domicilio"
              maxLength={200}
            />
          </div>
        </div>

        <div className="border-t p-4 bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={submitting || !saldoOk || descuentoInvalido}
            className="min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Check className="size-4 mr-2" />
                Confirmar venta
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LineaMedio({
  linea,
  onChange,
  onRemove,
  onCompletarSaldo,
  saldoDisponible,
  puedeRemover,
}: {
  linea: MedioLinea;
  onChange: (patch: Partial<Omit<MedioLinea, "id">>) => void;
  onRemove: () => void;
  onCompletarSaldo: () => void;
  saldoDisponible: number;
  puedeRemover: boolean;
}) {
  const necesitaReferencia =
    linea.medio === "transferencia" ||
    linea.medio === "deposito" ||
    linea.medio === "tarjeta_credito";

  const montoActual = linea.monto ?? 0;
  const mostrarCompletar =
    saldoDisponible > 0.01 && Math.abs(montoActual - saldoDisponible) > 0.01;

  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-4 gap-1 flex-1">
          {(
            [
              "efectivo",
              "transferencia",
              "deposito",
              "tarjeta_credito",
            ] as MedioPago[]
          ).map((medio) => (
            <button
              key={medio}
              type="button"
              onClick={() => onChange({ medio })}
              className={cn(
                "rounded-md border px-2 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5",
                linea.medio === medio
                  ? "border-foreground bg-muted"
                  : "border-border hover:border-foreground/40",
              )}
            >
              {MEDIOS_INFO[medio].icon}
              <span>{MEDIOS_INFO[medio].label}</span>
            </button>
          ))}
        </div>

        <NumericInput
          value={linea.monto}
          onChange={(monto) => onChange({ monto })}
          decimals={2}
          min={0}
          allowEmpty
          placeholder="0,00"
          className="w-28 text-right"
        />

        {puedeRemover && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="size-8 text-muted-foreground hover:text-destructive shrink-0"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {necesitaReferencia && (
        <Input
          value={linea.referencia}
          onChange={(e) => onChange({ referencia: e.target.value })}
          onFocus={selectAllOnFocus}
          placeholder="Nro. comprobante o referencia (opcional)"
          className="h-8 text-xs"
          maxLength={100}
        />
      )}

      {mostrarCompletar && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCompletarSaldo}
          className="h-7 text-xs text-muted-foreground hover:text-foreground -mt-0.5"
        >
          Completar con{" "}
          <span className="font-numeric font-medium ml-1">
            {formatARS(saldoDisponible)}
          </span>
        </Button>
      )}
    </div>
  );
}
