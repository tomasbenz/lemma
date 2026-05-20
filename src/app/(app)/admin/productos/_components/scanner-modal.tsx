"use client";

import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  normalizarCodigoBarras,
  pareceCodigoBarras,
} from "@/lib/codigo-barras/validar";

/**
 * Modal reutilizable para escanear un código de barras al form de producto.
 *
 * Resuelve el problema de foco: el lector USB tipea donde está el cursor, y
 * en un form con muchos campos el escaneo puede caer en el equivocado. Al
 * abrir este modal hay un solo input enfocado, el operador escanea, el código
 * vuelve al callback (que lo enruta al campo correcto) y el modal se cierra
 * solo. También permite tipeo manual con un botón Confirmar.
 */
export function ScannerModal({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (codigo: string) => void;
}) {
  const [valor, setValor] = useState("");
  const [errorInline, setErrorInline] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Foco al input cada vez que el modal abre. autoFocus solo no alcanza dentro
  // de un Dialog de Radix porque el FocusScope mueve el foco al primer
  // focusable al montar; con setTimeout(0) dejamos que ese ciclo termine y
  // recién entonces enfocamos el input. No hacemos setState acá: el reset del
  // estado ocurre en handleOpenChange al cerrar, así no disparamos cascading
  // renders desde el effect.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setValor("");
      setErrorInline(null);
    }
    onOpenChange(next);
  }

  function confirmar(valorActual: string) {
    const limpio = normalizarCodigoBarras(valorActual);
    if (!pareceCodigoBarras(limpio)) {
      setErrorInline("Código inválido (8-18 dígitos)");
      return;
    }
    onScan(limpio);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="size-4" />
            Escanear código de barras
          </DialogTitle>
          <DialogDescription>
            Pasá el producto por el lector o tipeá el código.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            ref={inputRef}
            autoFocus
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              if (errorInline) setErrorInline(null);
            }}
            inputMode="numeric"
            placeholder="Escaneá o tipeá el código"
            className="font-numeric"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              // El lector USB termina con Enter: si lo que llegó parece un
              // código válido, devolvemos y cerramos. Si no, dejamos al
              // operador corregir y confirmar manualmente.
              const limpio = normalizarCodigoBarras(e.currentTarget.value);
              if (pareceCodigoBarras(limpio)) {
                onScan(limpio);
                handleOpenChange(false);
              } else {
                setErrorInline("Código inválido (8-18 dígitos)");
              }
            }}
          />
          {errorInline && (
            <p className="text-xs text-destructive">{errorInline}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => confirmar(valor)}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
