// src/app/(app)/admin/pedidos/_actions/finalizar-pedido.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { emitirFacturaAfip } from "@/app/(app)/admin/ventas/_actions/emitir-factura-afip";
import { derivarTipoFactura } from "@/lib/afip/derivar-tipo-factura";
import type { TipoFacturaUI as TipoFactura } from "@/lib/types/factura";
type MedioPago =
  | "efectivo"
  | "transferencia"
  | "deposito"
  | "mercadopago_qr"
  | "tarjeta_credito"
  | "otro";

export type MedioPagoInput = {
  medio: MedioPago;
  monto: number;
  referencia?: string;
};

export type FinalizarPedidoInput = {
  pedidoId: string;
  clienteId?: string | null;
  mediosPago: MedioPagoInput[];
  descuentoTotal?: number;
  tipoFactura: TipoFactura;
  montoFacturado: number;
  /**
   * Si true, se aplica recargo del 10,5% al total cobrado.
   * Solo válido cuando hay factura emitida y se factura el 100% del total.
   */
  recargoFacturaCompleta?: boolean;
  /**
   * Porcentaje de recargo manual (0-100). Mutuamente excluyente con
   * recargoFacturaCompleta.
   */
  recargoPorcentajeManual?: number | null;
  /** Motivo opcional del recargo. */
  recargoMotivo?: string;
  notaInterna?: string;
};

export type FinalizarPedidoResult =
  | { ok: true; ventaId: string; numero: number; total: number }
  | { ok: false; error: string };

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function finalizarPedido(
  input: FinalizarPedidoInput,
): Promise<FinalizarPedidoResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "No autenticado" };
    if (user.rol === "vendedor") {
      return { ok: false, error: "No tenés permisos para finalizar pedidos" };
    }
    if (!user.empresa_id) {
      return { ok: false, error: "El pedido no existe" };
    }

    if (!input.mediosPago || input.mediosPago.length === 0) {
      return { ok: false, error: "Falta ingresar el medio de pago" };
    }

    for (const m of input.mediosPago) {
      if (m.monto <= 0) {
        return {
          ok: false,
          error: "Todos los medios de pago deben tener monto mayor a cero",
        };
      }
    }

    const descuento = redondear(input.descuentoTotal ?? 0);
    if (descuento < 0) {
      return { ok: false, error: "El descuento no puede ser negativo" };
    }

    const recargo = input.recargoFacturaCompleta ?? false;
    const recargoManual = input.recargoPorcentajeManual ?? null;

    // Mutex de recargos
    if (recargo && recargoManual !== null) {
      return {
        ok: false,
        error:
          "Solo se puede aplicar un tipo de recargo (10,5% factura completa O recargo manual)",
      };
    }

    // Validación del rango
    if (recargoManual !== null) {
      if (recargoManual < 0 || recargoManual > 100) {
        return { ok: false, error: "El recargo manual debe estar entre 0 y 100%" };
      }
    }

    if (recargo && input.tipoFactura === "sin_factura") {
      return {
        ok: false,
        error: "No se puede aplicar recargo del 10,5% sin emitir factura",
      };
    }

    if (input.tipoFactura !== "sin_factura") {
      if (input.montoFacturado <= 0) {
        return {
          ok: false,
          error: "El monto a facturar debe ser mayor a cero",
        };
      }
    }

    const mediosRpc = input.mediosPago.map((m) => ({
      medio: m.medio,
      monto: m.monto,
      referencia: m.referencia ?? null,
    }));

    const supabase = await createClient();

    // Si se pasó un clienteId distinto del que tenía el pedido, actualizarlo
    // antes de finalizar. La SQL finalizar_pedido no toca cliente_id.
    if (input.clienteId !== undefined) {
      const { error: updateError } = await supabase
        .from("ventas")
        .update({ cliente_id: input.clienteId })
        .eq("id", input.pedidoId)
        .eq("empresa_id", user.empresa_id)
        .eq("estado", "guardada");

      if (updateError) {
        console.error("[finalizarPedido] Error updating cliente:", updateError);
        return {
          ok: false,
          error: "No se pudo actualizar el cliente del pedido",
        };
      }
    }

    // Derivar tipo_factura final desde cond_iva del cliente actualizado.
    // El admin no elige A vs B — el sistema decide segun el receptor.
    // Si el cliente no se ve (RLS / borrado entre seleccion y submit),
    // lo pasamos como null al helper → cae a 'factura_b' (CF anonimo).
    let clienteParaDerivar = null;
    if (
      input.tipoFactura === "con_factura" &&
      input.clienteId !== undefined &&
      input.clienteId !== null
    ) {
      const { data: clienteData } = await supabase
        .from("clientes")
        .select("cond_iva, cuit")
        .eq("id", input.clienteId)
        .maybeSingle();
      clienteParaDerivar = clienteData ?? null;
    }

    const derivacion = derivarTipoFactura({
      tipoFactura: input.tipoFactura,
      cliente: clienteParaDerivar,
    });

    if (!derivacion.ok) {
      // Unico motivo posible: RI sin CUIT valido.
      return {
        ok: false,
        error:
          "El cliente RI no tiene CUIT cargado. Editá el cliente o reasigná el pedido a Consumidor Final.",
      };
    }

    const tipoFinal = derivacion.tipo;

    const { data, error } = await supabase.rpc("finalizar_pedido", {
      p_pedido_id: input.pedidoId,
      p_usuario_id: user.id,
      p_medios_pago: mediosRpc,
      p_descuento_total: descuento,
      p_tipo_factura: tipoFinal,
      p_monto_facturado: input.montoFacturado,
      p_nota_interna: input.notaInterna ?? null,
      p_recargo_factura_completa: recargo,
      p_recargo_porcentaje_manual: recargoManual,
      p_recargo_motivo: input.recargoMotivo?.trim() || null,
    } as never);

    if (error) {
      console.error("[finalizarPedido] Error RPC:", error);
      return {
        ok: false,
        error: error.message || "Error al finalizar el pedido",
      };
    }

    if (!data || typeof data !== "object") {
      return { ok: false, error: "Respuesta inválida del servidor" };
    }

    const result = data as {
      ok?: boolean;
      venta_id?: string;
      numero?: number;
      total?: number;
    };

    if (!result.ok || !result.venta_id) {
      return { ok: false, error: "El pedido no pudo finalizarse" };
    }

    const ventaId = result.venta_id;

    if (tipoFinal === "factura_a" || tipoFinal === "factura_b") {
      try {
        await emitirFacturaAfip(ventaId);
      } catch (err) {
        console.error("[finalizarPedido] emisión AFIP falló:", err);
      }
    }

    revalidatePath("/admin/pedidos");
    revalidatePath("/admin/ventas");
    revalidatePath("/admin/productos");
    revalidatePath("/caja");

    return {
      ok: true,
      ventaId,
      numero: result.numero ?? 0,
      total: result.total ?? 0,
    };
  } catch (error) {
    console.error("[finalizarPedido] Error inesperado:", error);
    const msg = error instanceof Error ? error.message : "Error inesperado";
    return { ok: false, error: msg };
  }
}
