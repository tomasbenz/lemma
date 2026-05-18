// src/app/(app)/admin/pedidos/[id]/_components/_panel-totales.tsx
"use client";

import { Separator } from "@/components/ui/separator";
import { formatARS } from "@/lib/format";

type Props = {
  subtotal: number;
  descuentoAplicado: number;
  recargoMonto: number; // > 0 si aplica recargo del 10,5%
  recargoManualMonto?: number; // > 0 si aplica recargo manual
  recargoManualPorcentaje?: number | null; // para label "Recargo X% manual"
  totalACobrar: number;
};

/**
 * Mini card con el desglose de totales: subtotal, descuento (si aplica),
 * recargo 10,5% (si aplica) y total a cobrar.
 *
 * IMPORTANTE: el sistema NO suma 21% al total. Los precios son netos.
 * Solo aparece el recargo del 10,5% cuando el admin lo elige explícitamente
 * en el modal (caso "factura 100% con recargo comercial").
 */
export function PanelTotales({
  subtotal,
  descuentoAplicado,
  recargoMonto,
  recargoManualMonto = 0,
  recargoManualPorcentaje = null,
  totalACobrar,
}: Props) {
  return (
    <div className="rounded-md border p-2.5 space-y-1 text-sm bg-muted/20">
      <div className="flex justify-between text-muted-foreground">
        <span>Subtotal neto</span>
        <span className="font-numeric">{formatARS(subtotal)}</span>
      </div>
      {descuentoAplicado > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <span>Descuento</span>
          <span className="font-numeric">− {formatARS(descuentoAplicado)}</span>
        </div>
      )}
      {recargoMonto > 0 && (
        <div className="flex justify-between text-muted-foreground">
          <span>Recargo 10,5%</span>
          <span className="font-numeric">+ {formatARS(recargoMonto)}</span>
        </div>
      )}
      {recargoManualMonto > 0 && recargoManualPorcentaje !== null && (
        <div className="flex justify-between text-muted-foreground">
          <span>Recargo {recargoManualPorcentaje}% manual</span>
          <span className="font-numeric">+ {formatARS(recargoManualMonto)}</span>
        </div>
      )}
      <Separator className="my-1" />
      <div className="flex justify-between text-base font-semibold">
        <span>Total a cobrar</span>
        <span className="font-numeric">{formatARS(totalACobrar)}</span>
      </div>
    </div>
  );
}
