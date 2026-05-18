"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/app/numeric-input";
import { selectAllOnFocus } from "@/lib/utils/select-all-on-focus";

type Props = {
  porcentaje: number | null;
  motivo: string;
  onPorcentajeChange: (v: number | null) => void;
  onMotivoChange: (v: string) => void;
  onClose: () => void;
};

export function RecargoManualForm({
  porcentaje,
  motivo,
  onPorcentajeChange,
  onMotivoChange,
  onClose,
}: Props) {
  const porcentajeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = porcentajeInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  return (
    <div className="rounded-md border border-foreground/40 p-2.5 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Recargo manual</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="recargo-manual-porcentaje"
          className="text-[10px] text-muted-foreground"
        >
          Porcentaje del recargo
        </Label>
        <div className="relative">
          <NumericInput
            ref={porcentajeInputRef}
            id="recargo-manual-porcentaje"
            value={porcentaje}
            onChange={onPorcentajeChange}
            decimals={1}
            min={0}
            max={100}
            allowEmpty
            placeholder="Ej: 30"
            className="pr-8"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            %
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor="recargo-manual-motivo"
          className="text-[10px] text-muted-foreground"
        >
          Motivo (opcional)
        </Label>
        <Input
          id="recargo-manual-motivo"
          value={motivo}
          onChange={(e) => onMotivoChange(e.target.value)}
          onFocus={selectAllOnFocus}
          placeholder="Ej: pago con tarjeta de crédito"
          maxLength={200}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
