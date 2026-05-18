// src/app/(app)/admin/productos/_actions/importar-productos.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

export type ProductoImport = {
  sku_base: string;
  nombre: string;
  categoria: string | null;
  precio_neto: number;
};

export type ImportarProductosResult =
  | {
      ok: true;
      total: number;
      creados: number;
      actualizados: number;
    }
  | {
      ok: false;
      error: string;
      // Si el error es por validación de items, vienen los detalles
      errores_validacion?: { fila: number; sku: string; motivo: string }[];
    };

/**
 * Importa productos desde la plantilla. ATÓMICA: si una fila tiene error,
 * no se importa NADA.
 *
 * El parsing del Excel se hace en el cliente (xlsx en el navegador), esta
 * action solo recibe el array ya estructurado.
 */
export async function importarProductos(
  productos: ProductoImport[],
): Promise<ImportarProductosResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "No autenticado" };
    if (user.rol === "vendedor") {
      return { ok: false, error: "Solo admin puede importar productos" };
    }

    if (!Array.isArray(productos) || productos.length === 0) {
      return { ok: false, error: "No hay productos para importar" };
    }
    if (productos.length > 5000) {
      return { ok: false, error: "Máximo 5000 productos por importación" };
    }

    // Sanitización superficial antes de mandar al SQL
    const productosLimpios = productos.map((p) => ({
      sku_base: String(p.sku_base ?? "").trim(),
      nombre: String(p.nombre ?? "").trim(),
      categoria: p.categoria ? String(p.categoria).trim() : null,
      precio_neto:
        typeof p.precio_neto === "number" && !isNaN(p.precio_neto)
          ? p.precio_neto
          : -1,
    }));

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("importar_productos_bulk", {
      p_usuario_id: user.id,
      p_productos: productosLimpios,
    } as never);

    if (error) {
      console.error("[importarProductos] Error RPC:", error);
      return {
        ok: false,
        error: error.message || "Error al importar productos",
      };
    }

    if (!data || typeof data !== "object") {
      return { ok: false, error: "Respuesta inválida del servidor" };
    }

    const result = data as {
      ok?: boolean;
      total?: number;
      creados?: number;
      actualizados?: number;
      errores?: { fila: number; sku: string; motivo: string }[];
      cantidad_errores?: number;
    };

    if (!result.ok) {
      return {
        ok: false,
        error: "La importación falló por errores de validación",
        errores_validacion: result.errores ?? [],
      };
    }

    revalidatePath("/admin/productos");
    revalidatePath("/caja");

    return {
      ok: true,
      total: result.total ?? 0,
      creados: result.creados ?? 0,
      actualizados: result.actualizados ?? 0,
    };
  } catch (error) {
    console.error("[importarProductos] Error inesperado:", error);
    const msg = error instanceof Error ? error.message : "Error inesperado";
    return { ok: false, error: msg };
  }
}
