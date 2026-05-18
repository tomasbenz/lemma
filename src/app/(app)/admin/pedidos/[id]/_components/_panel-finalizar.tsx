// src/app/(app)/admin/pedidos/[id]/_components/_panel-finalizar.tsx
"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/app/numeric-input";
import { SelectorCliente } from "@/app/(app)/caja/_components/selector-cliente";
import { RecargoManualForm } from "@/components/app/recargo-manual-form";
import { toast } from "sonner";
import { selectAllOnFocus } from "@/lib/utils/select-all-on-focus";
import { formatARS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PanelTotales } from "./_panel-totales";
import { PanelMediosPago, type MedioLinea } from "./_panel-medios-pago";
import type { ClienteCaja } from "@/lib/queries/clientes-caja";
import type { TipoFacturaUI as TipoFactura } from "@/lib/types/factura";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Props = {
  // Totales
  subtotal: number;
  descuentoAplicado: number;
  totalNeto: number;
  totalACobrar: number;
  recargoMonto: number;
  diferencia: number;
  saldoOk: boolean;

  // Cliente
  clientes: ClienteCaja[];
  clienteId: string | null;
  setClienteId: (id: string | null) => void;

  // Descuento
  descuentoPct: number | null;
  setDescuentoPct: (v: number | null) => void;
  descuentoMonto: number | null;
  setDescuentoMonto: (v: number | null) => void;
  descuentoModo: "porcentaje" | "monto";
  setDescuentoModo: (modo: "porcentaje" | "monto") => void;

  // Facturación
  tipoFactura: TipoFactura;
  setTipoFactura: (t: TipoFactura) => void;
  montoFacturado: number | null;
  setMontoFacturado: (v: number | null) => void;
  recargoFacturaCompleta: boolean;
  setRecargoFacturaCompleta: (v: boolean) => void;
  recargoManualPorcentaje: number | null;
  setRecargoManualPorcentaje: (v: number | null) => void;
  recargoManualMotivo: string;
  setRecargoManualMotivo: (v: string) => void;
  mostrarRecargoManual: boolean;
  setMostrarRecargoManual: (v: boolean) => void;
  recargoManualMonto: number;

  // Medios de pago
  medios: MedioLinea[];
  agregarMedio: () => void;
  actualizarMedio: (id: string, patch: Partial<Omit<MedioLinea, "id">>) => void;
  removerMedio: (id: string) => void;
  aplicarRestoAUltimo: () => void;
  completarSaldoEnLinea: (id: string) => void;

  // Nota
  notaInterna: string;
  setNotaInterna: (v: string) => void;

  // Submit
  submitting: boolean;
  hayProblemasCriticos: boolean;
  onFinalizar: () => void;
};

/**
 * Panel derecho con todo el flujo de finalización del pedido:
 * cliente, descuento, facturación (con opción de recargo 10,5%),
 * medios de pago, nota y botón finalizar.
 */
export function PanelFinalizar({
  subtotal,
  descuentoAplicado,
  totalNeto,
  totalACobrar,
  recargoMonto,
  diferencia,
  saldoOk,
  clientes,
  clienteId,
  setClienteId,
  descuentoPct,
  setDescuentoPct,
  descuentoMonto,
  setDescuentoMonto,
  descuentoModo,
  setDescuentoModo,
  tipoFactura,
  setTipoFactura,
  montoFacturado,
  setMontoFacturado,
  recargoFacturaCompleta,
  setRecargoFacturaCompleta,
  recargoManualPorcentaje,
  setRecargoManualPorcentaje,
  recargoManualMotivo,
  setRecargoManualMotivo,
  mostrarRecargoManual,
  setMostrarRecargoManual,
  recargoManualMonto,
  medios,
  agregarMedio,
  actualizarMedio,
  removerMedio,
  aplicarRestoAUltimo,
  completarSaldoEnLinea,
  notaInterna,
  setNotaInterna,
  submitting,
  hayProblemasCriticos,
  onFinalizar,
}: Props) {
  // Detectar % preset activo (sobre el total cobrado)
  const PORCENTAJES_PRESET = [30, 50, 100] as const;
  let porcentajeActivo: number | null = null;
  if (montoFacturado && tipoFactura !== "sin_factura") {
    for (const p of PORCENTAJES_PRESET) {
      const valorEsperado = round2(totalACobrar * (p / 100));
      if (Math.abs(montoFacturado - valorEsperado) < 0.01) {
        porcentajeActivo = p;
        break;
      }
    }
  }

  const aplicarPorcentaje = (porcentaje: number) => {
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
  };

  return (
    <Card className="surface-2 enter-up stagger-2">
      <CardHeader>
        <CardTitle className="text-base">Finalizar pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <PanelTotales
          subtotal={subtotal}
          descuentoAplicado={descuentoAplicado}
          recargoMonto={recargoMonto}
          recargoManualMonto={recargoManualMonto}
          recargoManualPorcentaje={recargoManualPorcentaje}
          totalACobrar={totalACobrar}
        />

        <div className="space-y-1.5 rounded-md border-2 border-foreground/15 p-3">
          <Label className="text-xs font-medium text-muted-foreground">
            Cliente
          </Label>
          <SelectorCliente
            clientes={clientes}
            clienteId={clienteId}
            onChange={setClienteId}
            permitirCrearCliente
          />
        </div>

        <div className="space-y-1.5 rounded-md border-2 border-foreground/15 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Descuento (opcional)
            </Label>
            <div
              className="flex rounded-md border bg-background p-0.5"
              role="group"
              aria-label="Modo de descuento"
            >
              <button
                type="button"
                onClick={() => setDescuentoModo("porcentaje")}
                aria-pressed={descuentoModo === "porcentaje"}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs font-medium font-numeric transition-colors",
                  descuentoModo === "porcentaje"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setDescuentoModo("monto")}
                aria-pressed={descuentoModo === "monto"}
                className={cn(
                  "rounded-sm px-2 py-0.5 text-xs font-medium transition-colors",
                  descuentoModo === "monto"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                $
              </button>
            </div>
          </div>
          {descuentoModo === "porcentaje" ? (
            <div className="relative">
              <NumericInput
                value={descuentoPct}
                onChange={setDescuentoPct}
                decimals={1}
                min={0}
                max={100}
                allowEmpty
                placeholder="0"
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                %
              </span>
            </div>
          ) : (
            <NumericInput
              value={descuentoMonto}
              onChange={setDescuentoMonto}
              decimals={2}
              min={0}
              allowEmpty
              prefix="$"
              placeholder="0,00"
            />
          )}
          {descuentoAplicado > 0 && (
            <p className="text-xs text-muted-foreground font-numeric">
              − {formatARS(descuentoAplicado)} sobre subtotal
            </p>
          )}
        </div>

        <div className="space-y-1.5 rounded-md border-2 border-foreground/15 p-3">
          <Label className="text-xs font-medium text-muted-foreground">
            Recargo manual (opcional)
          </Label>
          {!mostrarRecargoManual ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={recargoFacturaCompleta}
              onClick={() => setMostrarRecargoManual(true)}
              className="w-full justify-start text-xs text-muted-foreground h-9"
            >
              + Aplicar recargo manual
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

        <div className="space-y-1.5 rounded-md border-2 border-foreground/15 p-3">
          <Label className="text-xs font-medium text-muted-foreground">
            Facturación
          </Label>
          <div className="grid grid-cols-2 gap-1">
            {(["sin_factura", "con_factura"] as TipoFactura[]).map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => setTipoFactura(tipo)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs font-medium text-center touch-target transition-colors duration-200",
                  tipoFactura === tipo
                    ? "border-foreground bg-muted"
                    : "border-border md:hover:border-foreground/40",
                )}
              >
                {tipo === "sin_factura" ? "Sin" : "Con factura"}
              </button>
            ))}
          </div>

          {tipoFactura !== "sin_factura" && (
            <div className="pt-2 space-y-2.5">
              {/* RECARGO 10,5% */}
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
                  <div className="text-xs font-medium">
                    Cobrar 10,5% extra al cliente
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    El cliente paga {formatARS(totalNeto)} +{" "}
                    {formatARS(round2(totalNeto * 0.105))} ={" "}
                    {formatARS(round2(totalNeto * 1.105))}. Se factura el 100%
                    por ese monto.
                  </p>
                </div>
              </label>

              {/* MONTO A FACTURAR */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Monto a facturar
                  </Label>
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
                            "rounded border px-2 py-0.5 text-[10px] font-medium font-numeric tabular-nums transition-colors",
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
                </div>

                <NumericInput
                  value={montoFacturado}
                  onChange={setMontoFacturado}
                  decimals={2}
                  min={0}
                  allowEmpty
                  prefix="$"
                  placeholder="0,00"
                  disabled={
                    recargoFacturaCompleta || recargoManualPorcentaje !== null
                  }
                />

                {porcentajeActivo !== null &&
                  porcentajeActivo < 100 &&
                  !recargoFacturaCompleta && (
                    <p className="text-[10px] text-muted-foreground">
                      Facturando {porcentajeActivo}% del total ·{" "}
                      {formatARS(totalACobrar - (montoFacturado ?? 0))} sin
                      facturar
                    </p>
                  )}

                {(recargoFacturaCompleta ||
                  recargoManualPorcentaje !== null) && (
                  <p className="text-[10px] text-muted-foreground">
                    Con recargo se factura el 100% por {formatARS(totalACobrar)}
                    .
                  </p>
                )}

              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border-2 border-foreground/15 p-3">
          <PanelMediosPago
            medios={medios}
            totalACobrar={totalACobrar}
            diferencia={diferencia}
            saldoOk={saldoOk}
            onAgregar={agregarMedio}
            onActualizar={actualizarMedio}
            onRemover={removerMedio}
            onAplicarRestoAUltimo={aplicarRestoAUltimo}
            onCompletarSaldoEnLinea={completarSaldoEnLinea}
          />
        </div>

        <div className="space-y-1.5 rounded-md border-2 border-foreground/15 p-3">
          <Label className="text-xs font-medium text-muted-foreground">
            Nota adicional (opcional)
          </Label>
          <Input
            value={notaInterna}
            onChange={(e) => setNotaInterna(e.target.value)}
            onFocus={selectAllOnFocus}
            placeholder="Se agrega a la nota original"
            maxLength={200}
            className="h-9"
          />
        </div>

        <Separator className="my-1" />

        <Button
          type="button"
          onClick={onFinalizar}
          disabled={submitting || !saldoOk || hayProblemasCriticos}
          className="w-full h-11 touch-target"
          size="lg"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <Check className="size-4 mr-2" />
              Finalizar pedido
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
