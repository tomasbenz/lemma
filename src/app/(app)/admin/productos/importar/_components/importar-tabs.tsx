'use client'

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { ImportarProductosView } from './importar-productos-view'
import { ImportarActualizarView } from './importar-actualizar-view'

export function ImportarTabs() {
  return (
    <Tabs defaultValue="template" className="space-y-4">
      <TabsList>
        <TabsTrigger value="template">Crear y actualizar (template)</TabsTrigger>
        <TabsTrigger value="export">Actualizar desde export</TabsTrigger>
      </TabsList>

      <TabsContent value="template">
        <ImportarProductosView />
      </TabsContent>

      <TabsContent value="export" className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Subí el Excel que exportaste (con tus cambios). Solo actualiza
          productos existentes —no crea nada— matcheando por SKU de variante.
        </p>
        <ImportarActualizarView />
      </TabsContent>
    </Tabs>
  )
}
