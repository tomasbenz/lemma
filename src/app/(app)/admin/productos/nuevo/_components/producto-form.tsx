// src/app/(app)/admin/productos/nuevo/_components/producto-form.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDebouncedCallback } from "use-debounce";
import { Plus, Trash2, Package, Check, AlertCircle, X } from "lucide-react";
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
import { NumericInput } from "@/components/app/numeric-input";
import { ImagenProductoUpload } from "../../_components/imagen-producto-upload";
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

/**
 * Form de producto con variantes generalizadas por atributos arbitrarios.
 *
 * Cada variante tiene un array de pares (clave, valor) que se serializa al
 * jsonb `atributos`. Reemplaza el wizard color/talle del proyecto Loom Point
 * (textil) por un esquema flexible que sirve a cualquier rubro: librería
 * (color, formato, gramaje), alimentos (presentación, sabor), etc.
 *
 * Futuro: cuando exista `categoria_atributos` poblado, el form puede leer
 * los atributos esperados para la categoría seleccionada y renderizar
 * fields dinámicos en vez de pares key/value libres.
 */
export function ProductoForm({
  initialData,
}: {
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
      codigo_barras: "",
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
      append({ atributos: [], stock: 0 });
    }
  };

  function onInvalid(errors: typeof form.formState.errors) {
    console.warn("[ProductoForm] Validación falló:", errors);
    const variantesError = errors.variantes;
    const variantesMsg =
      variantesError && !Array.isArray(variantesError)
        ? variantesError.message
        : Array.isArray(variantesError)
          ? "Revisá los atributos de las variantes: cada uno necesita nombre y valor."
          : null;
    const primerError =
      errors.nombre?.message ||
      errors.sku_base?.message ||
      errors.precio_neto?.message ||
      errors.codigo_barras?.message ||
      variantesMsg ||
      "Revisá los campos marcados en el formulario.";
    toast.error(
      typeof primerError === "string"
        ? primerError
        : "Revisá los campos del formulario.",
    );
  }

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
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
                      placeholder="Ej: Cuaderno A4 tapa dura 80h"
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
                      placeholder="Ej: Cuadernos, Lápices, Témperas"
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
                          placeholder="CUA-001"
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
                      placeholder="Ej: Cuaderno tapa dura, hojas rayadas, 80 hojas"
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
                      Ej: distintos colores, formatos, gramajes, presentaciones.
                      Cada variante maneja su propio stock.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {!tieneVariantes && (
              <>
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

                <FormField
                  control={form.control}
                  name="codigo_barras"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código de barras</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          inputMode="numeric"
                          placeholder="Escaneá o tipeá el código"
                          className="font-numeric"
                          // El lector USB "tipea" los dígitos y manda Enter.
                          // Bloqueamos el Enter para que no dispare el submit
                          // del form: el código queda en el campo y la usuaria
                          // confirma con el botón "Crear/Guardar".
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Opcional. Escaneá el código de barras impreso del
                        producto con el lector, o tipealo a mano.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
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
                    onClick={() => append({ atributos: [], stock: 0 })}
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
                    <VarianteFields
                      key={field.id}
                      form={form}
                      varianteIndex={index}
                      onRemove={() => remove(index)}
                    />
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

/**
 * Render de una variante individual: pares clave/valor de atributos + stock.
 *
 * useFieldArray anidado para que la usuaria pueda agregar/quitar atributos
 * dinámicamente. Si la categoría tiene atributos definidos en
 * `categoria_atributos`, futuro: prellenar las claves esperadas.
 */
function VarianteFields({
  form,
  varianteIndex,
  onRemove,
}: {
  form: ReturnType<typeof useForm<ProductoFormValues, unknown, ProductoInput>>;
  varianteIndex: number;
  onRemove: () => void;
}) {
  const {
    fields: atributoFields,
    append: appendAtributo,
    remove: removeAtributo,
  } = useFieldArray({
    control: form.control,
    name: `variantes.${varianteIndex}.atributos`,
  });

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      {/*
        Hidden input que arrastra el id de la variante existente desde el
        initialData hasta el submit. Sin esto, react-hook-form no incluiría
        el id en los datos del field array y la server action no podría
        matchear por id (perdiendo stock e historial al cambiar atributos).
        Las variantes nuevas que agrega el usuario no tienen id: el register
        las deja en undefined y el schema lo acepta como opcional.

        El campo se llama `varianteId` (no `id`) porque useFieldArray reserva
        la propiedad `id` para su key tracking interno y, si se la pisamos, el
        register no monta el input en el DOM y el id nunca llega al submit.
      */}
      <input
        type="hidden"
        {...form.register(`variantes.${varianteIndex}.varianteId`)}
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Variante #{varianteIndex + 1}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="size-7 text-destructive hover:text-destructive shrink-0"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Quitar variante</span>
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <FormLabel className="text-xs">Atributos</FormLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => appendAtributo({ clave: "", valor: "" })}
          >
            <Plus className="size-3 mr-1" />
            Atributo
          </Button>
        </div>

        {atributoFields.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            Sin atributos. La variante quedará como DEFAULT.
          </p>
        )}

        {atributoFields.map((atributoField, atributoIndex) => (
          <div key={atributoField.id} className="flex items-start gap-2">
            <FormField
              control={form.control}
              name={`variantes.${varianteIndex}.atributos.${atributoIndex}.clave`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder="Ej: color"
                      {...field}
                      className="h-8 text-xs"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`variantes.${varianteIndex}.atributos.${atributoIndex}.valor`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder="Ej: rojo"
                      {...field}
                      className="h-8 text-xs"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAtributo(atributoIndex)}
              className="size-7 text-muted-foreground hover:text-destructive shrink-0"
            >
              <X className="size-3.5" />
              <span className="sr-only">Quitar atributo</span>
            </Button>
          </div>
        ))}
      </div>

      <FormField
        control={form.control}
        name={`variantes.${varianteIndex}.stock`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Stock</FormLabel>
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

      <FormField
        control={form.control}
        name={`variantes.${varianteIndex}.codigo_barras`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Código de barras</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ""}
                inputMode="numeric"
                placeholder="Escaneá o tipeá el código"
                className="font-numeric h-8 text-xs"
                // El lector USB "tipea" el código y manda Enter al final.
                // Bloqueamos el Enter para que no dispare el submit del form.
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
