// src/app/(app)/admin/pedidos/[id]/_components/_panel-medios-pago.tsx
"use client";

import {
  Plus,
  Trash2,
  Banknote,
  ArrowRightLeft,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/app/numeric-input";
import { formatARS } from "@/lib/format";
import { selectAllOnFocus } from "@/lib/utils/select-all-on-focus";
import { cn } from "@/lib/utils";

export type MedioPago = "efectivo" | "transferencia" | "deposito";

export type MedioLinea = {
  id: string;
  medio: MedioPago;
  monto: number | null;
  referencia: string;
};

const MEDIOS_INFO: Record<MedioPago, { label: string; icon: React.ReactNode }> =
  {
    efectivo: { label: "Efectivo", icon: <Banknote className="size-4" /> },
    transferencia: {
      label: "Transferencia",
      icon: <ArrowRightLeft className="size-4" />,
    },
    deposito: { label: "Depósito", icon: <Building2 className="size-4" /> },
  };

type Props = {
  medios: MedioLinea[];
  totalACobrar: number;
  diferencia: number;
  saldoOk: boolean;
  onAgregar: () => void;
  onActualizar: (id: string, patch: Partial<Omit<MedioLinea, "id">>) => void;
  onRemover: (id: string) => void;
  onAplicarRestoAUltimo: () => void;
  onCompletarSaldoEnLinea: (id: string) => void;
};

/**
 * Lista de medios de pago con su saldo. Permite agregar, quitar y
 * autocompletar montos.
 */
export function PanelMediosPago({
  medios,
  totalACobrar,
  diferencia,
  saldoOk,
  onAgregar,
  onActualizar,
  onRemover,
  onAplicarRestoAUltimo,
  onCompletarSaldoEnLinea,
}: Props) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">
          Medios de pago
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAgregar}
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
              onChange={(patch) => onActualizar(m.id, patch)}
              onRemove={() => onRemover(m.id)}
              onCompletarSaldo={() => onCompletarSaldoEnLinea(m.id)}
              saldoDisponible={saldoDisponible}
              puedeRemover={medios.length > 1}
            />
          );
        })}
      </div>

      <div
        className={cn(
          "rounded-md border p-2 flex items-center justify-between text-sm mt-2",
          saldoOk
            ? "border-success/40 bg-success/5 text-success"
            : "border-warning/40 bg-warning/5",
        )}
      >
        <span className="font-medium text-xs">
          {saldoOk ? "Saldo correcto" : diferencia > 0 ? "Falta" : "Sobra"}
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
              onClick={onAplicarRestoAUltimo}
              className="h-6 text-xs"
            >
              Aplicar resto
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Sub-componente: una línea de medio de pago ============

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
    linea.medio === "transferencia" || linea.medio === "deposito";

  const montoActual = linea.monto ?? 0;
  // No mostrar el botón "Completar con X" cuando saldoDisponible <= 0
  // (excedente o ya cubierto). Solo cuando hay falta real Y este medio
  // no tiene ya el valor correcto.
  const mostrarCompletar =
    saldoDisponible > 0.01 && Math.abs(montoActual - saldoDisponible) > 0.01;

  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <div className="grid grid-cols-3 gap-1">
        {(["efectivo", "transferencia", "deposito"] as MedioPago[]).map(
          (medio) => (
            <button
              key={medio}
              type="button"
              onClick={() => onChange({ medio })}
              className={cn(
                "rounded-md border px-1.5 py-1.5 text-[11px] font-medium flex items-center justify-center gap-1 touch-target transition-colors duration-200",
                linea.medio === medio
                  ? "border-foreground bg-muted"
                  : "border-border md:hover:border-foreground/40",
              )}
            >
              {MEDIOS_INFO[medio].icon}
              <span className="hidden sm:inline">
                {MEDIOS_INFO[medio].label}
              </span>
            </button>
          ),
        )}
      </div>

      <div className="flex items-center gap-2">
        <NumericInput
          value={linea.monto}
          onChange={(monto) => onChange({ monto })}
          decimals={2}
          min={0}
          allowEmpty
          placeholder="0,00"
          className="flex-1 text-right"
        />

        {puedeRemover && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="size-9 text-muted-foreground hover:text-destructive shrink-0 touch-target"
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
          placeholder="Nro. comprobante (opcional)"
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
