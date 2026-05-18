// src/app/(app)/admin/productos/nuevo/_components/producto-form.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDebouncedCallback } from "use-debounce";
import { Plus, Trash2, Package, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ComboboxCatalogo } from "@/components/app/combobox-catalogo";
import { NumericInput } from "@/components/app/numeric-input";
import { ImagenProductoUpload } from "../../_components/imagen-producto-upload";
import type { CatalogoItem } from "@/lib/queries/catalogos";
import {
  productoSchema,
  type ProductoInput,
  type ProductoFormValues,
} from "@/lib/validations/producto";
import {
  crearProducto,
  verificarSkuDisponible,
  sugerirSkuBase,
} from "../../nuevo/_actions/crear-producto";
import { actualizarProducto } from "../../[id]/editar/_actions/actualizar-producto";

type SkuStatus =
  | { estado: "ocioso" }
  | { estado: "verificando" }
  | { estado: "disponible" }
  | { estado: "no_disponible"; mensaje: string };

export type ProductoFormInitialData = ProductoInput & {
  id: string;
};

export function ProductoForm({
  colores,
  talles,
  initialData,
}: {
  colores: CatalogoItem[];
  talles: CatalogoItem[];
  initialData?: ProductoFormInitialData;
}) {
  const router = useRouter();
  const esEdicion = !!initialData;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skuStatus, setSkuStatus] = useState<SkuStatus>({ estado: "ocioso" });
  const [skuManual, setSkuManual] = useState(esEdicion);

  const form = useForm<ProductoFormValues, unknown, ProductoInput>({
    resolver: zodResolver(productoSchema),
    defaultValues: initialData ?? {
      nombre: "",
      sku_base: "",
      precio_neto: 0,
      categoria: "",
      descripcion_corta: "",
      imagen_url: null,
      track_stock: true,
      tiene_variantes: false,
      stock_inicial: 0,
      variantes: [],
    },
    mode: "onBlur",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variantes",
  });

  const tieneVariantes = form.watch("tiene_variantes");
  const categoria = form.watch("categoria");
  const sku = form.watch("sku_base");

  // ============ AUTO-SUGERIR SKU cuando cambia la categoría (solo en alta) ============
  const sugerirSku = useDebouncedCallback(async (cat: string) => {
    if (esEdicion) return;
    if (skuManual) return;
    if (!cat || cat.trim().length < 3) return;

    const sugerido = await sugerirSkuBase(cat);
    if (sugerido && !skuManual) {
      form.setValue("sku_base", sugerido, { shouldValidate: true });
    }
  }, 500);

  useEffect(() => {
    if (categoria && !esEdicion) {
      sugerirSku(categoria);
    }
  }, [categoria, sugerirSku, esEdicion]);

  // ============ VALIDAR SKU DISPONIBLE en tiempo real ============
  const verificarSku = useDebouncedCallback(async (valor: string) => {
    if (!valor || valor.length < 2) {
      setSkuStatus({ estado: "ocioso" });
      return;
    }

    if (esEdicion && initialData && valor === initialData.sku_base) {
      setSkuStatus({ estado: "disponible" });
      return;
    }

    setSkuStatus({ estado: "verificando" });
    const resultado = await verificarSkuDisponible(valor);

    if (resultado.disponible) {
      setSkuStatus({ estado: "disponible" });
    } else {
      setSkuStatus({
        estado: "no_disponible",
        mensaje: resultado.mensaje ?? "Ya está en uso",
      });
    }
  }, 400);

  useEffect(() => {
    if (sku) {
      verificarSku(sku);
    } else {
      setSkuStatus({ estado: "ocioso" });
    }
  }, [sku, verificarSku]);

  const onToggleVariantes = (checked: boolean) => {
    form.setValue("tiene_variantes", checked);
    if (checked && fields.length === 0) {
      append({ color: "", talle: "", stock: 0 });
    }
  };

  async function onSubmit(data: ProductoInput) {
    if (skuStatus.estado === "no_disponible") {
      toast.error("El SKU ya está en uso. Elegí otro.");
      return;
    }

    // track_stock siempre true: el toggle se eliminó de la UI por decisión
    // de producto. Todos los productos tienen tracking de stock activo.
    const dataConTracking: ProductoInput = { ...data, track_stock: true };

    setIsSubmitting(true);
    try {
      const result = esEdicion
        ? await actualizarProducto(initialData!.id, dataConTracking)
        : await crearProducto(dataConTracking);

      if (!result.ok) {
        toast.error(result.error);
        if ("field" in result && result.field === "sku_base") {
          form.setError("sku_base", { message: result.error });
        }
        return;
      }

      toast.success(
        esEdicion
          ? `"${data.nombre}" actualizado correctamente`
          : `Producto "${data.nombre}" creado correctamente`,
      );

      if (esEdicion) {
        router.push(`/admin/productos/${result.productoId}`);
      } else {
        router.push("/admin/productos");
      }
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("Error inesperado al guardar");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* ============ DATOS BÁSICOS ============ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="size-4" />
              Datos del producto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="imagen_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Imagen</FormLabel>
                  <FormControl>
                    <ImagenProductoUpload
                      value={field.value ?? null}
                      onChange={field.onChange}
                      productoId={initialData?.id ?? null}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Opcional. Se comprime automáticamente a max 1200px.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Remera básica cuello redondo"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Remeras, Buzos, Accesorios"
                      {...field}
                    />
                  </FormControl>
                  {!esEdicion && (
                    <FormDescription className="text-xs">
                      Si completás la categoría, el SKU se sugiere
                      automáticamente
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sku_base"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder="REM-001"
                          {...field}
                          className="font-numeric pr-9"
                          onChange={(e) => {
                            setSkuManual(true);
                            field.onChange(e.target.value.toUpperCase());
                          }}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          {skuStatus.estado === "verificando" && (
                            <div className="size-4 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
                          )}
                          {skuStatus.estado === "disponible" && (
                            <Check className="size-4 text-success" />
                          )}
                          {skuStatus.estado === "no_disponible" && (
                            <AlertCircle className="size-4 text-destructive" />
                          )}
                        </div>
                      </div>
                    </FormControl>
                    {skuStatus.estado === "no_disponible" ? (
                      <p className="text-sm text-destructive">
                        {skuStatus.mensaje}
                      </p>
                    ) : (
                      <FormDescription className="text-xs">
                        {esEdicion
                          ? "Cuidado al cambiar el SKU: afecta los identificadores de todas las variantes."
                          : "Identificador único. Una vez usado, no se puede repetir (ni siquiera en productos dados de baja)."}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="precio_neto"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio neto *</FormLabel>
                    <FormControl>
                      <NumericInput
                        value={field.value ?? null}
                        onChange={(v) => field.onChange(v ?? 0)}
                        decimals={2}
                        min={0}
                        prefix="$"
                        allowEmpty
                        placeholder="0,00"
                        className="font-numeric"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Sin IVA
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descripcion_corta"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción corta</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ej: Remera 100% algodón, corte regular"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Opcional. Útil para el catálogo online más adelante.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ============ STOCK Y VARIANTES ============ */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock y variantes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="tiene_variantes"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        onToggleVariantes(checked === true)
                      }
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Este producto tiene variantes</FormLabel>
                    <FormDescription className="text-xs">
                      Ej: distintos colores, talles, tamaños, etc. Cada variante
                      maneja su propio stock.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {!tieneVariantes && (
              <FormField
                control={form.control}
                name="stock_inicial"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {esEdicion ? "Stock" : "Stock inicial"}
                    </FormLabel>
                    <FormControl>
                      <NumericInput
                        value={field.value ?? null}
                        onChange={(v) => field.onChange(v ?? 0)}
                        decimals={0}
                        min={0}
                        allowEmpty
                        placeholder="0"
                        className="w-32 font-numeric"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {tieneVariantes && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Variantes ({fields.length})
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ color: "", talle: "", stock: 0 })}
                  >
                    <Plus className="size-4 mr-1" />
                    Agregar variante
                  </Button>
                </div>

                {fields.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    Agregá al menos una variante
                  </p>
                )}

                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-12 gap-2 p-3 rounded-md border bg-muted/20"
                    >
                      <FormField
                        control={form.control}
                        name={`variantes.${index}.color`}
                        render={({ field }) => (
                          <FormItem className="col-span-12 sm:col-span-4">
                            <FormLabel className="text-xs">Color</FormLabel>
                            <FormControl>
                              <ComboboxCatalogo
                                value={field.value ?? ""}
                                onChange={field.onChange}
                                options={colores}
                                placeholder="Seleccionar color"
                                searchPlaceholder="Buscar o escribir color..."
                                emptyLabel="No hay colores en el catálogo"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`variantes.${index}.talle`}
                        render={({ field }) => (
                          <FormItem className="col-span-6 sm:col-span-3">
                            <FormLabel className="text-xs">Talle</FormLabel>
                            <FormControl>
                              <ComboboxCatalogo
                                value={field.value ?? ""}
                                onChange={field.onChange}
                                options={talles}
                                placeholder="Seleccionar talle"
                                searchPlaceholder="Buscar o escribir talle..."
                                emptyLabel="No hay talles en el catálogo"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`variantes.${index}.stock`}
                        render={({ field }) => (
                          <FormItem className="col-span-4 sm:col-span-3">
                            <FormLabel className="text-xs">Stock</FormLabel>
                            <FormControl>
                              <NumericInput
                                value={field.value ?? null}
                                onChange={(v) => field.onChange(v ?? 0)}
                                decimals={0}
                                min={0}
                                allowEmpty
                                placeholder="0"
                                className="font-numeric"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="col-span-2 flex items-end justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Quitar variante</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {form.formState.errors.variantes?.message && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.variantes.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" asChild>
            <a
              href={
                esEdicion
                  ? `/admin/productos/${initialData!.id}`
                  : "/admin/productos"
              }
            >
              Cancelar
            </a>
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || skuStatus.estado === "no_disponible"}
          >
            {isSubmitting
              ? "Guardando..."
              : esEdicion
                ? "Guardar cambios"
                : "Crear producto"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
