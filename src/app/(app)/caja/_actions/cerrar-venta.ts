// src/app/(app)/caja/_actions/cerrar-venta.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  isRecargoManualHabilitado,
  isRecargo105Habilitado,
} from "@/lib/features";
import { emitirFacturaAfip } from "@/app/(app)/admin/ventas/_actions/emitir-factura-afip";
import { derivarTipoFactura } from "@/lib/afip/derivar-tipo-factura";
import type { Atributos } from "@/lib/format-atributos";
import type { TipoFacturaUI as TipoFactura } from "@/lib/types/factura";
type MedioPago =
  | "efectivo"
  | "transferencia"
  | "deposito"
  | "mercadopago_qr"
  | "tarjeta_credito"
  | "otro";

export type ItemVentaInput = {
  varianteId: string;
  productoNombre: string;
  productoSku: string;
  skuVariante: string;
  /**
   * Snapshot de atributos de la variante. Reemplaza el viejo par (color, talle).
   * Se persiste en items_venta.variante_atributos como jsonb. Vacío {} si
   * la variante no tenía atributos (caso DEFAULT).
   */
  atributos: Atributos;
  cantidad: number;
  precioUnitarioNeto: number;
};

export type MedioPagoInput = {
  medio: MedioPago;
  monto: number;
  referencia?: string;
};

export type CerrarVentaInput = {
  clienteId: string | null;
  /**
   * Nombre alternativo del cliente para mostrar en ticket/factura/listado.
   * Útil para identificar pedidos de web o consumidor final con nombre,
   * tipo "TOMAS BENZ #32009". Si está seteado, sobreescribe la razón social
   * en lugares de display (la venta sigue ligada al cliente real si hay).
   */
  nombreClienteCustom?: string;
  canal?: string;
  items: ItemVentaInput[];
  mediosPago: MedioPagoInput[];
  descuentoTotal?: number;
  tipoFactura: TipoFactura;
  montoFacturado: number;
  /**
   * Si true, se aplica recargo del 10,5% al total cobrado.
   * Solo válido cuando hay factura emitida (no sin_factura).
   * Solo válido cuando se factura el 100% del total (no parcial).
   */
  recargoFacturaCompleta?: boolean;
  /**
   * Porcentaje de recargo manual (0-100). Mutuamente excluyente con
   * recargoFacturaCompleta. Si null/undefined, no se aplica recargo manual.
   */
  recargoPorcentajeManual?: number | null;
  /** Motivo opcional del recargo (auditoría informativa). */
  recargoMotivo?: string;
  notaInterna?: string;
};

export type CerrarVentaResult =
  | { ok: true; ventaId: string; numero: number; total: number }
  | { ok: false; error: string };

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function cerrarVenta(
  input: CerrarVentaInput,
): Promise<CerrarVentaResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "No autenticado" };

    if (!input.items || input.items.length === 0) {
      return { ok: false, error: "La venta no tiene items" };
    }
    if (!input.mediosPago || input.mediosPago.length === 0) {
      return { ok: false, error: "Falta ingresar el medio de pago" };
    }

    for (const item of input.items) {
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        return {
          ok: false,
          error: `Cantidad inválida para ${item.productoNombre}`,
        };
      }
      if (item.precioUnitarioNeto < 0) {
        return {
          ok: false,
          error: `Precio inválido para ${item.productoNombre}`,
        };
      }
    }

    for (const m of input.mediosPago) {
      if (m.monto <= 0) {
        return {
          ok: false,
          error: "Todos los medios de pago deben tener monto mayor a cero",
        };
      }
    }

    const subtotal = redondear(
      input.items.reduce(
        (acc, i) => acc + i.precioUnitarioNeto * i.cantidad,
        0,
      ),
    );
    const descuento = redondear(input.descuentoTotal ?? 0);

    if (descuento < 0) {
      return { ok: false, error: "El descuento no puede ser negativo" };
    }
    if (descuento > subtotal) {
      return { ok: false, error: "El descuento supera el subtotal" };
    }

    const totalNeto = redondear(subtotal - descuento);

    // Feature flags por empresa (defense in depth — la UI ya oculta los
    // toggles cuando los flags están apagados, pero el server descarta
    // cualquier intento de bypass desde el cliente).
    //
    //   recargo_105_habilitado    → permite recargoFacturaCompleta (10,5%).
    //   recargo_manual_habilitado → permite recargoPorcentajeManual (% libre).
    //
    // Cada flag controla SOLO su campo. Si está apagado, el campo se fuerza
    // a su valor "sin recargo" (false / null) sin importar lo que vino.
    const [recargo105Habilitado, recargoManualHabilitado] = user.empresa_id
      ? await Promise.all([
          isRecargo105Habilitado(user.empresa_id),
          isRecargoManualHabilitado(user.empresa_id),
        ])
      : [false, false];
    const recargo = recargo105Habilitado
      ? (input.recargoFacturaCompleta ?? false)
      : false;
    const recargoManual = recargoManualHabilitado
      ? (input.recargoPorcentajeManual ?? null)
      : null;

    // Mutex de recargos
    if (recargo && recargoManual !== null) {
      return {
        ok: false,
        error:
          "Solo se puede aplicar un tipo de recargo (10,5% factura completa O recargo manual)",
      };
    }

    // Validación del rango del % manual
    if (recargoManual !== null) {
      if (recargoManual < 0 || recargoManual > 100) {
        return { ok: false, error: "El recargo manual debe estar entre 0 y 100%" };
      }
    }

    // Coherencia del recargo
    if (recargo && input.tipoFactura === "sin_factura") {
      return {
        ok: false,
        error: "No se puede aplicar recargo del 10,5% sin emitir factura",
      };
    }

    // Total a cobrar al cliente. Prioridad: 10,5% > manual > sin recargo.
    const totalACobrar =
      recargo ? redondear(totalNeto * 1.105) :
      recargoManual !== null ? redondear(totalNeto * (1 + recargoManual / 100)) :
      totalNeto;

    const sumaMedios = redondear(
      input.mediosPago.reduce((acc, m) => acc + m.monto, 0),
    );

    if (Math.abs(sumaMedios - totalACobrar) > 0.02) {
      return {
        ok: false,
        error: `La suma de medios de pago ($${sumaMedios}) no coincide con el total a cobrar ($${totalACobrar})`,
      };
    }

    if (input.tipoFactura !== "sin_factura") {
      if (input.montoFacturado <= 0) {
        return {
          ok: false,
          error: "El monto a facturar debe ser mayor a cero",
        };
      }
      if (input.montoFacturado > totalACobrar + 0.02) {
        return {
          ok: false,
          error: "El monto a facturar no puede superar el total cobrado",
        };
      }
      // Si hay recargo, monto facturado debe igualar el total cobrado
      if (recargo && Math.abs(input.montoFacturado - totalACobrar) > 0.02) {
        return {
          ok: false,
          error:
            "Con recargo del 10,5% el monto facturado debe igualar el total cobrado",
        };
      }
    }

    const itemsRpc = input.items.map((i) => ({
      variante_id: i.varianteId,
      producto_nombre: i.productoNombre,
      producto_sku: i.productoSku,
      variante_sku: i.skuVariante,
      variante_atributos: i.atributos,
      cantidad: i.cantidad,
      precio_unitario_neto: i.precioUnitarioNeto,
      subtotal_neto: redondear(i.precioUnitarioNeto * i.cantidad),
    }));

    const mediosRpc = input.mediosPago.map((m) => ({
      medio: m.medio,
      monto: m.monto,
      referencia: m.referencia ?? null,
    }));

    const supabase = await createClient();

    // Derivar tipo_factura final desde cond_iva del cliente.
    // La cajera no elige A vs B — el sistema decide segun el receptor.
    // Si el cliente no se ve (RLS / borrado entre seleccion y submit),
    // lo pasamos como null al helper → cae a 'factura_b' (CF anonimo).
    let clienteParaDerivar = null;
    if (
      input.tipoFactura === "con_factura" &&
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
          "El cliente RI no tiene CUIT cargado. Editá el cliente o vendé como Consumidor Final.",
      };
    }

    const tipoFinal = derivacion.tipo;

    const nombreCustomClean = input.nombreClienteCustom?.trim() || null;

    const { data, error } = await supabase.rpc("cerrar_venta", {
      p_usuario_id: user.id,
      p_cliente_id: input.clienteId,
      p_canal: input.canal ?? "mostrador",
      p_items: itemsRpc,
      p_medios_pago: mediosRpc,
      p_descuento_total: descuento,
      p_tipo_factura: tipoFinal,
      p_monto_facturado: input.montoFacturado,
      p_nota_interna: input.notaInterna ?? null,
      p_nombre_cliente_custom: nombreCustomClean,
      p_recargo_factura_completa: recargo,
      p_recargo_porcentaje_manual: recargoManual,
      p_recargo_motivo: input.recargoMotivo?.trim() || null,
    } as never);

    if (error) {
      console.error("[cerrarVenta] Error RPC:", error);
      return {
        ok: false,
        error: error.message || "Error al cerrar la venta",
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
      return { ok: false, error: "La venta no pudo cerrarse" };
    }

    const ventaId = result.venta_id;

    if (tipoFinal === "factura_a" || tipoFinal === "factura_b") {
      try {
        await emitirFacturaAfip(ventaId);
      } catch (err) {
        console.error("[cerrarVenta] emisión AFIP falló:", err);
      }
    }

    revalidatePath("/caja");
    revalidatePath("/admin/productos");
    revalidatePath("/admin/ventas");

    return {
      ok: true,
      ventaId,
      numero: result.numero ?? 0,
      total: result.total ?? totalNeto,
    };
  } catch (error) {
    console.error("[cerrarVenta] Error inesperado:", error);
    const msg = error instanceof Error ? error.message : "Error inesperado";
    return { ok: false, error: msg };
  }
}
