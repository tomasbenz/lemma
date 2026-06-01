// src/app/(app)/admin/productos/nuevo/_components/producto-form.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDebouncedCallback } from "use-debounce";
import {
  Plus,
  Trash2,
  Package,
  Check,
  AlertCircle,
  X,
  ScanBarcode,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumericInput } from "@/components/app/numeric-input";
import {
  ComboboxCatalogo,
  type ComboboxOption,
} from "@/components/app/combobox-catalogo";
import { cn } from "@/lib/utils";
import { ImagenProductoUpload } from "../../_components/imagen-producto-upload";
import { ScannerModal } from "../../_components/scanner-modal";
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
import { crearMarca } from "../../_actions/crear-marca";
import { actualizarProducto } from "../../[id]/editar/_actions/actualizar-producto";

// Sentinela "sin categoría" para el Select (radix no permite value=""). En el
// submit se mapea a '' (que la action convierte a null).
const SIN_CATEGORIA = "__sin__";

/** Normaliza igual que la DB (lower + sin tildes + espacios colapsados). */
function normalizarNombre(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/\s+/g, " ");
}

type SkuStatus =
  | { estado: "ocioso" }
  | { estado: "verificando" }
  | { estado: "disponible" }
  | { estado: "no_disponible"; mensaje: string };

// Paths del form a los que puede apuntar el scanner: el código del producto
// simple, o el de una variante específica por índice. Tipear esto en vez de
// usar `string` permite pasarle el valor a form.setValue sin `as any`.
type ScanTarget = "codigo_barras" | `variantes.${number}.codigo_barras`;

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
  marcas,
  categorias,
}: {
  initialData?: ProductoFormInitialData;
  marcas: ComboboxOption[];
  categorias: ComboboxOption[];
}) {
  const router = useRouter();
  const esEdicion = !!initialData;
  // Lista local de marcas: se le agregan las creadas al vuelo desde el combobox.
  const [marcasLocal, setMarcasLocal] = useState<ComboboxOption[]>(marcas);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skuStatus, setSkuStatus] = useState<SkuStatus>({ estado: "ocioso" });
  const [skuManual, setSkuManual] = useState(esEdicion);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<ScanTarget | null>(null);

  const form = useForm<ProductoFormValues, unknown, ProductoInput>({
    resolver: zodResolver(productoSchema),
    defaultValues: initialData ?? {
      nombre: "",
      sku_base: "",
      precio_neto: 0,
      costo: null,
      marca_id: "",
      categoria_id: "",
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
  const marcaId = form.watch("marca_id");
  const sku = form.watch("sku_base");

  // ============ MARGEN EN TIEMPO REAL ============
  // margen = (precio - costo) / precio. Solo si ambos > 0. Sin estado extra.
  const costoWatch = form.watch("costo");
  const precioWatch = form.watch("precio_neto");
  const margen =
    typeof costoWatch === "number" &&
    costoWatch > 0 &&
    typeof precioWatch === "number" &&
    precioWatch > 0
      ? ((precioWatch - costoWatch) / precioWatch) * 100
      : null;

  // ============ AUTO-SUGERIR SKU cuando cambia la marca (solo en alta) ============
  // El prefijo del SKU se deriva del nombre de la marca (preserva el
  // comportamiento previo, cuando "categoria" era en realidad la marca).
  const sugerirSku = useDebouncedCallback(async (texto: string) => {
    if (esEdicion) return;
    if (skuManual) return;
    if (!texto || texto.trim().length < 3) return;

    const sugerido = await sugerirSkuBase(texto);
    if (sugerido && !skuManual) {
      form.setValue("sku_base", sugerido, { shouldValidate: true });
    }
  }, 500);

  useEffect(() => {
    if (marcaId && !esEdicion) {
      const nombre = marcasLocal.find((m) => m.id === marcaId)?.nombre;
      if (nombre) sugerirSku(nombre);
    }
  }, [marcaId, marcasLocal, sugerirSku, esEdicion]);

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

  function agregarVariante() {
    append({ atributos: [], stock: 0 });
    // Doble rAF para garantizar que la variante recién agregada ya esté
    // montada en el DOM antes de scrollear (un solo rAF a veces corre antes
    // del commit de React). Sin esto, querySelector encuentra el array
    // viejo y el scroll cae en la variante anterior.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const items = document.querySelectorAll("[data-variante-item]");
        const ultimo = items[items.length - 1];
        ultimo?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  function abrirScanner(fieldName: ScanTarget) {
    setScanTarget(fieldName);
    setScannerOpen(true);
  }

  function onScan(codigo: string) {
    if (!scanTarget) return;
    form.setValue(scanTarget, codigo, { shouldValidate: true });
  }

  function onInvalid(errors: typeof form.formState.errors) {
    console.warn("[ProductoForm] Validación falló:", errors);
    const variantesError = errors.variantes;
    let variantesMsg: string | null = null;
    if (variantesError && !Array.isArray(variantesError)) {
      // Error a nivel del array (ej: refine "agregá al menos una variante").
      variantesMsg =
        typeof variantesError.message === "string"
          ? variantesError.message
          : null;
    } else if (Array.isArray(variantesError)) {
      // Pinea la primera variante/campo que falla con el mensaje real del
      // schema, en vez del viejo texto hardcodeado que siempre culpaba a los
      // atributos (enmascaraba fallas de codigo_barras, stock, etc.).
      for (let i = 0; i < variantesError.length && !variantesMsg; i++) {
        const v = variantesError[i] as
          | {
              codigo_barras?: { message?: string };
              stock?: { message?: string };
              varianteId?: { message?: string };
              atributos?:
                | { message?: string }
                | Array<
                    | { clave?: { message?: string }; valor?: { message?: string } }
                    | undefined
                  >;
            }
          | undefined;
        if (!v) continue;
        const nro = i + 1;
        if (v.codigo_barras?.message) {
          variantesMsg = `Variante ${nro}: ${v.codigo_barras.message}`;
        } else if (v.stock?.message) {
          variantesMsg = `Variante ${nro}: ${v.stock.message}`;
        } else if (v.varianteId?.message) {
          variantesMsg = `Variante ${nro}: ${v.varianteId.message}`;
        } else if (Array.isArray(v.atributos)) {
          for (let j = 0; j < v.atributos.length && !variantesMsg; j++) {
            const a = v.atributos[j];
            if (a?.clave?.message) {
              variantesMsg = `Variante ${nro}, atributo ${j + 1}: ${a.clave.message}`;
            } else if (a?.valor?.message) {
              variantesMsg = `Variante ${nro}, atributo ${j + 1}: ${a.valor.message}`;
            }
          }
          if (!variantesMsg) {
            variantesMsg = `Variante ${nro}: hay un error de validación`;
          }
        } else if (
          v.atributos &&
          "message" in v.atributos &&
          v.atributos.message
        ) {
          variantesMsg = `Variante ${nro}: ${v.atributos.message}`;
        } else {
          variantesMsg = `Variante ${nro}: hay un error de validación`;
        }
      }
    }
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

      // Volvemos al listado con ?recien=<id> para destacar el producto recién
      // guardado (la navegación post-guardado vive acá, no en la server action).
      router.push(`/admin/productos?recien=${result.productoId}`);
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Marca: combobox con búsqueda fuzzy + alta al vuelo (creatable). */}
              <FormField
                control={form.control}
                name="marca_id"
                render={({ field }) => {
                  const marcaActual = marcasLocal.find(
                    (m) => m.id === field.value,
                  );
                  return (
                    <FormItem>
                      <FormLabel>Marca</FormLabel>
                      <FormControl>
                        <ComboboxCatalogo
                          value={marcaActual?.nombre ?? ""}
                          options={marcasLocal}
                          placeholder="Elegí o creá una marca"
                          emptyLabel="Sin marcas todavía"
                          searchPlaceholder="Buscar o crear marca…"
                          onChange={async (nombre) => {
                            const norm = normalizarNombre(nombre);
                            const existente = marcasLocal.find(
                              (m) => m.nombre_normalizado === norm,
                            );
                            if (existente) {
                              field.onChange(existente.id);
                              return;
                            }
                            // Nueva marca: la creamos y usamos su id.
                            const res = await crearMarca(nombre);
                            if (!res.ok) {
                              toast.error(res.error);
                              return;
                            }
                            const nueva: ComboboxOption = {
                              id: res.id,
                              nombre: res.nombre,
                              nombre_normalizado: res.nombre_normalizado,
                            };
                            setMarcasLocal((prev) =>
                              prev.some((m) => m.id === nueva.id)
                                ? prev
                                : [...prev, nueva].sort((a, b) =>
                                    a.nombre.localeCompare(b.nombre, "es", {
                                      sensitivity: "base",
                                    }),
                                  ),
                            );
                            field.onChange(nueva.id);
                          }}
                        />
                      </FormControl>
                      {!esEdicion && (
                        <FormDescription className="text-xs">
                          Si elegís una marca, el SKU se sugiere automáticamente.
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Categoría real: solo selección (se administran en Catálogos). */}
              <FormField
                control={form.control}
                name="categoria_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <Select
                      value={field.value || SIN_CATEGORIA}
                      onValueChange={(v) =>
                        field.onChange(v === SIN_CATEGORIA ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin categoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={SIN_CATEGORIA}>
                          Sin categoría
                        </SelectItem>
                        {categorias.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Opcional. Las categorías se administran en Catálogos.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <FormDescription className="text-xs">Sin IVA</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="costo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Costo</FormLabel>
                    <FormControl>
                      <NumericInput
                        value={field.value ?? null}
                        onChange={(v) => field.onChange(v ?? null)}
                        decimals={2}
                        min={0}
                        prefix="$"
                        allowEmpty
                        placeholder="0,00"
                        className="font-numeric"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Lo que pagás al proveedor. Sirve para calcular margen.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Indicador de margen en tiempo real (debajo del precio/costo) */}
            {margen !== null && (
              <p
                className={cn(
                  "text-sm font-medium",
                  margen >= 30
                    ? "text-success"
                    : margen >= 0
                      ? "text-warning"
                      : "text-destructive"
                )}
              >
                {margen < 0
                  ? `¡Pérdida! Margen: ${margen.toFixed(1)}%`
                  : margen >= 30
                    ? `Margen: ${margen.toFixed(1)}%`
                    : `Margen bajo: ${margen.toFixed(1)}%`}
              </p>
            )}

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
                        <div className="flex gap-2">
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
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => abrirScanner("codigo_barras")}
                          >
                            <ScanBarcode className="size-4 mr-1" />
                            Escanear
                          </Button>
                        </div>
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
                    onClick={agregarVariante}
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
                      abrirScanner={abrirScanner}
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

      <ScannerModal
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={onScan}
      />
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
  abrirScanner,
}: {
  form: ReturnType<typeof useForm<ProductoFormValues, unknown, ProductoInput>>;
  varianteIndex: number;
  onRemove: () => void;
  abrirScanner: (fieldName: ScanTarget) => void;
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
    <div
      data-variante-item
      className="rounded-md border bg-muted/20 p-3 space-y-3"
    >
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
              <div className="flex gap-2">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() =>
                    abrirScanner(`variantes.${varianteIndex}.codigo_barras`)
                  }
                >
                  <ScanBarcode className="size-3 mr-1" />
                  Escanear
                </Button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
