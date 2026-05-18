// src/app/(app)/admin/productos/importar/page.tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportarProductosView } from "./_components/importar-productos-view";

export const metadata = {
  title: "Importar productos | Loom Point",
};

export default function ImportarProductosPage() {
  return (
    <div className="flex-1 p-3 md:p-4 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/productos">
              <ArrowLeft className="size-4 mr-1" />
              Volver a productos
            </Link>
          </Button>
        </div>

        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Importar productos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Subí un Excel con tu catálogo. Los productos nuevos se crean, los
            existentes se actualizan. El stock se carga después por producto.
          </p>
        </div>

        <ImportarProductosView />
      </div>
    </div>
  );
}
