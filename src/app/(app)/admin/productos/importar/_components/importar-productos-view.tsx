// src/app/(app)/admin/productos/importar/_components/importar-productos-view.tsx
"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  X,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatARS } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  importarProductos,
  type ProductoImport,
} from "../../_actions/importar-productos";

// =============================================================================
// La plantilla EXIGE estas 5 columnas con estos nombres exactos
// =============================================================================
const COLUMNAS_REQUERIDAS = [
  "sku_base",
  "nombre",
  "marca",
  "categoria",
  "precio_neto",
] as const;

type FilaPlantilla = {
  sku_base: string;
  nombre: string;
  marca: string;
  categoria: string;
  precio_neto: number;
};

type FilaParseada = FilaPlantilla & {
  fila: number; // 1-indexed para humano
};

type ResultadoExito = {
  total: number;
  creados: number;
  actualizados: number;
};

type ResultadoErrores = {
  errores: { fila: number; sku: string; motivo: string }[];
};

// =============================================================================
// Genera y descarga la plantilla vacía con el formato correcto
// =============================================================================
function descargarPlantilla() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["sku_base", "nombre", "marca", "categoria", "precio_neto"],
    ["ABC123", "Lápiz negro HB", "Faber-Castell", "Escritura", 1500],
    ["ABC124", "Cuaderno tapa dura A4", "Rivadavia", "Cuadernos", 8000],
  ]);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 45 },
    { wch: 24 },
    { wch: 24 },
    { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Productos");
  XLSX.writeFile(wb, "plantilla-productos.xlsx");
}

// =============================================================================
// Componente principal
// =============================================================================
export function ImportarProductosView() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [filas, setFilas] = useState<FilaParseada[]>([]);
  const [erroresParser, setErroresParser] = useState<string[]>([]);
  const [parseando, setParseando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState<ResultadoExito | null>(null);
  const [erroresValidacion, setErroresValidacion] =
    useState<ResultadoErrores | null>(null);

  // ============ Parser estricto ============
  const procesarArchivo = useCallback(async (file: File) => {
    setParseando(true);
    setArchivo(file);
    setFilas([]);
    setErroresParser([]);
    setExito(null);
    setErroresValidacion(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });

      if (rows.length === 0) {
        toast.error("El archivo está vacío");
        setArchivo(null);
        return;
      }

      // Validar que existan las 4 columnas requeridas
      const headers = Object.keys(rows[0]);
      const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !headers.includes(c));
      if (faltantes.length > 0) {
        toast.error(
          `Faltan columnas: ${faltantes.join(", ")}. Descargá la plantilla para ver el formato correcto.`,
        );
        setArchivo(null);
        return;
      }

      // Parsear filas con validación cliente
      const erroresLocales: string[] = [];
      const filasParseadas: FilaParseada[] = [];
      const skusVistos = new Set<string>();

      rows.forEach((row, idx) => {
        const numFila = idx + 2; // +2 porque la fila 1 es header

        const sku = String(row.sku_base ?? "").trim();
        const nombre = String(row.nombre ?? "").trim();
        const marca = String(row.marca ?? "").trim();
        const categoria = String(row.categoria ?? "").trim();
        const precioRaw = row.precio_neto;

        // Skip filas completamente vacías
        if (!sku && !nombre && !precioRaw) return;

        if (!sku) {
          erroresLocales.push(`Fila ${numFila}: SKU vacío`);
          return;
        }
        if (!nombre) {
          erroresLocales.push(`Fila ${numFila}: nombre vacío`);
          return;
        }
        if (skusVistos.has(sku)) {
          erroresLocales.push(`Fila ${numFila}: SKU "${sku}" duplicado`);
          return;
        }
        skusVistos.add(sku);

        const precio = Number(precioRaw);
        if (isNaN(precio) || precio < 0) {
          erroresLocales.push(
            `Fila ${numFila} (${sku}): precio inválido o negativo`,
          );
          return;
        }

        filasParseadas.push({
          fila: numFila,
          sku_base: sku,
          nombre,
          marca,
          categoria,
          precio_neto: precio,
        });
      });

      if (erroresLocales.length > 0) {
        setErroresParser(erroresLocales);
        toast.error(
          `${erroresLocales.length} error${erroresLocales.length === 1 ? "" : "es"} en el archivo. Revisá el detalle.`,
        );
        return;
      }

      if (filasParseadas.length === 0) {
        toast.error("No se encontró ningún producto en el archivo");
        setArchivo(null);
        return;
      }

      setFilas(filasParseadas);
      toast.success(
        `${filasParseadas.length} producto${filasParseadas.length === 1 ? "" : "s"} listo${filasParseadas.length === 1 ? "" : "s"} para importar`,
      );
    } catch (err) {
      console.error("[importar] error parseando:", err);
      toast.error("Error leyendo el archivo. ¿Es un .xlsx válido?");
      setArchivo(null);
    } finally {
      setParseando(false);
    }
  }, []);

  // ============ Drag & drop ============
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(true);
  }, []);
  const onDragLeave = useCallback(() => setArrastrando(false), []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setArrastrando(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const ext = file.name.toLowerCase().split(".").pop();
      if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
        toast.error("Formato no soportado. Subí un .xlsx, .xls o .csv");
        return;
      }
      procesarArchivo(file);
    },
    [procesarArchivo],
  );
  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) procesarArchivo(file);
    },
    [procesarArchivo],
  );

  // ============ Importar ============
  async function handleImportar() {
    if (filas.length === 0) return;

    const productos: ProductoImport[] = filas.map((f) => ({
      sku_base: f.sku_base,
      nombre: f.nombre,
      marca: f.marca || null,
      categoria: f.categoria || null,
      precio_neto: f.precio_neto,
    }));

    setEnviando(true);
    const result = await importarProductos(productos);
    setEnviando(false);

    if (!result.ok) {
      if (result.errores_validacion && result.errores_validacion.length > 0) {
        setErroresValidacion({ errores: result.errores_validacion });
        toast.error(
          `${result.errores_validacion.length} error${result.errores_validacion.length === 1 ? "" : "es"} de validación. No se importó nada.`,
        );
      } else {
        toast.error(result.error);
      }
      return;
    }

    setExito({
      total: result.total,
      creados: result.creados,
      actualizados: result.actualizados,
    });
    toast.success(
      `${result.creados} creado${result.creados === 1 ? "" : "s"} · ${result.actualizados} actualizado${result.actualizados === 1 ? "" : "s"}`,
    );
    router.refresh();
  }

  function handleReset() {
    setArchivo(null);
    setFilas([]);
    setErroresParser([]);
    setExito(null);
    setErroresValidacion(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function descargarErroresCsv() {
    if (!erroresValidacion) return;
    const csv =
      "fila,sku,motivo\n" +
      erroresValidacion.errores
        .map(
          (e) =>
            `${e.fila},"${e.sku.replace(/"/g, '""')}","${e.motivo.replace(/"/g, '""')}"`,
        )
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "errores-importacion.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // Render: ÉXITO
  // =========================================================================
  if (exito) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-success/10 text-success p-2">
              <Check className="size-5" />
            </div>
            <div>
              <CardTitle>Importación completada</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {exito.total} producto{exito.total === 1 ? "" : "s"} procesado
                {exito.total === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResumenItem label="Creados" valor={exito.creados} ok />
            <ResumenItem label="Actualizados" valor={exito.actualizados} ok />
          </div>

          <div className="rounded-md border p-3 bg-muted/20 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Próximos pasos</p>
            <p>
              Los productos se crearon sin variantes ni stock. Para empezar a
              vender uno, entrá al detalle del producto y agregá colores, talles
              y stock inicial.
            </p>
          </div>

          <Separator />

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleReset}>
              Importar otro archivo
            </Button>
            <Button onClick={() => router.push("/admin/productos")}>
              Ir al catálogo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // =========================================================================
  // Render: ERRORES DE VALIDACIÓN DEL SERVIDOR (no se importó nada)
  // =========================================================================
  if (erroresValidacion) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-destructive/10 text-destructive p-2">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <CardTitle>No se importó nada</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {erroresValidacion.errores.length} error
                {erroresValidacion.errores.length === 1 ? "" : "es"} de
                validación. Arreglá el archivo y volvé a intentarlo.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Detalle de errores</p>
            <Button variant="outline" size="sm" onClick={descargarErroresCsv}>
              <Download className="size-3.5 mr-1.5" />
              CSV
            </Button>
          </div>

          <div className="rounded-md border max-h-80 overflow-y-auto no-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                <tr>
                  <th className="text-left p-2 font-medium w-16">Fila</th>
                  <th className="text-left p-2 font-medium">SKU</th>
                  <th className="text-left p-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {erroresValidacion.errores.map((e, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-numeric text-muted-foreground">
                      {e.fila}
                    </td>
                    <td className="p-2 font-numeric">{e.sku}</td>
                    <td className="p-2">{e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button variant="outline" onClick={handleReset}>
              Volver a empezar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // =========================================================================
  // Render: ERRORES DE PARSER LOCAL (antes de mandar al servidor)
  // =========================================================================
  if (erroresParser.length > 0) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-destructive/10 text-destructive p-2">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <CardTitle>Hay errores en el archivo</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Arreglá estos problemas y volvé a subir el archivo
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border max-h-80 overflow-y-auto no-scrollbar p-2 space-y-1">
            {erroresParser.map((err, i) => (
              <p key={i} className="text-xs font-mono">
                {err}
              </p>
            ))}
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleReset}>
              Volver a empezar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // =========================================================================
  // Render: DROP ZONE (sin archivo todavía)
  // =========================================================================
  if (!archivo) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors",
                arrastrando
                  ? "border-foreground bg-muted"
                  : "border-border hover:border-foreground/40",
              )}
            >
              <Upload className="size-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium text-sm">
                Arrastrá tu archivo o hacé click para seleccionar
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Formatos: .xlsx, .xls, .csv · Máximo 5000 productos
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onFilePick}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground text-sm">
                  ¿Cómo armar el archivo?
                </p>
                <p>
                  El archivo tiene que tener exactamente estas 5 columnas, con
                  estos nombres:
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  <li>
                    <code className="text-[11px] bg-muted px-1 rounded">
                      sku_base
                    </code>{" "}
                    — código único del producto
                  </li>
                  <li>
                    <code className="text-[11px] bg-muted px-1 rounded">
                      nombre
                    </code>{" "}
                    — nombre del producto
                  </li>
                  <li>
                    <code className="text-[11px] bg-muted px-1 rounded">
                      marca
                    </code>{" "}
                    — marca del producto (si no existe se crea; puede quedar
                    vacía)
                  </li>
                  <li>
                    <code className="text-[11px] bg-muted px-1 rounded">
                      categoria
                    </code>{" "}
                    — categoría real del catálogo (si no existe se ignora; puede
                    quedar vacía)
                  </li>
                  <li>
                    <code className="text-[11px] bg-muted px-1 rounded">
                      precio_neto
                    </code>{" "}
                    — precio sin IVA, solo números
                  </li>
                </ul>
                <p className="pt-1">
                  Si una sola fila tiene error, no se importa nada (todo o
                  nada).
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={descargarPlantilla}
                className="shrink-0"
              >
                <Download className="size-3.5 mr-1.5" />
                Plantilla
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =========================================================================
  // Render: PREVIEW con archivo cargado y listo
  // =========================================================================
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex items-center gap-3">
          <FileSpreadsheet className="size-8 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{archivo.name}</p>
            <p className="text-xs text-muted-foreground">
              {parseando
                ? "Procesando..."
                : `${filas.length} producto${filas.length === 1 ? "" : "s"} listo${filas.length === 1 ? "" : "s"} para importar`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            disabled={enviando}
          >
            <X className="size-4" />
          </Button>
        </CardContent>
      </Card>

      {!parseando && filas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <p className="text-xs text-muted-foreground">
              Mostrando los primeros 50 productos.
            </p>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto no-scrollbar">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2 font-medium">SKU</th>
                    <th className="text-left p-2 font-medium">Nombre</th>
                    <th className="text-left p-2 font-medium">Marca</th>
                    <th className="text-left p-2 font-medium">Categoría</th>
                    <th className="text-right p-2 font-medium">Precio neto</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.slice(0, 50).map((f) => (
                    <tr key={f.fila} className="border-t hover:bg-muted/20">
                      <td className="p-2 font-numeric">{f.sku_base}</td>
                      <td className="p-2">{f.nombre}</td>
                      <td className="p-2 text-muted-foreground">
                        {f.marca || "—"}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {f.categoria || "—"}
                      </td>
                      <td className="p-2 text-right font-numeric">
                        {formatARS(f.precio_neto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filas.length > 50 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                ... y {filas.length - 50} producto
                {filas.length - 50 === 1 ? "" : "s"} más
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleReset} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          onClick={handleImportar}
          disabled={enviando || parseando || filas.length === 0}
          className="min-w-[180px]"
        >
          {enviando ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Importando...
            </>
          ) : (
            <>
              <Check className="size-4 mr-2" />
              Importar {filas.length} producto{filas.length === 1 ? "" : "s"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-componente
// =============================================================================
function ResumenItem({
  label,
  valor,
  ok,
}: {
  label: string;
  valor: number;
  ok?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-center",
        ok && "border-success/40 bg-success/5",
      )}
    >
      <div
        className={cn("text-2xl font-bold font-numeric", ok && "text-success")}
      >
        {valor}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
        {label}
      </div>
    </div>
  );
}
