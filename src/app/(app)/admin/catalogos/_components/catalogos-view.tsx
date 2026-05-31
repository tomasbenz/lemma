// src/app/(app)/admin/catalogos/_components/catalogos-view.tsx
'use client'

import { useState, useTransition, type ComponentType } from 'react'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  FolderTree,
  Tags,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { CatalogoItemAdmin } from '@/lib/queries/catalogos'
import {
  crearCatalogoItem,
  editarCatalogoItem,
  setCatalogoItemActivo,
} from '../_actions/catalogos-actions'

// Tablas de catálogo que comparten forma + CRUD. Espejo del `type Tabla`
// del lado server (catalogos-actions.ts). Lo dejamos local para no exportar
// tipos desde un módulo 'use server'.
type Tabla = 'catalogo_categorias' | 'marcas'

/**
 * Vista de catálogos.
 *
 * El refactor de Lemma generalizó variantes a un jsonb `atributos` y
 * eliminó las tablas `catalogo_talles` y `catalogo_colores` (eran
 * específicas del rubro textil del cliente original Loom Point).
 *
 * Acá vive el CRUD de `catalogo_categorias` y `marcas`: comparten la misma
 * forma de tabla, así que el componente `CatalogoTab` se parametriza por
 * `tabla` y se reusa para ambas. La definición de atributos esperados por
 * categoría (`categoria_atributos`) tiene su propio CRUD pendiente y se
 * gestiona por ahora vía la migración seed o SQL directo.
 */
export function CatalogosView({
  categorias,
  marcas,
}: {
  categorias: CatalogoItemAdmin[]
  marcas: CatalogoItemAdmin[]
}) {
  return (
    <Tabs defaultValue="categorias" className="space-y-4">
      <TabsList>
        <TabsTrigger value="categorias">
          <FolderTree className="size-4" />
          Categorías
        </TabsTrigger>
        <TabsTrigger value="marcas">
          <Tags className="size-4" />
          Marcas
        </TabsTrigger>
      </TabsList>

      <TabsContent value="categorias">
        <CatalogoTab
          tabla="catalogo_categorias"
          items={categorias}
          singular="categoría"
          plural="categorías"
          genero="f"
          icono={FolderTree}
          placeholderNombre="Ej: Cuadernos, Lápices, Témperas"
        />
      </TabsContent>

      <TabsContent value="marcas">
        <CatalogoTab
          tabla="marcas"
          items={marcas}
          singular="marca"
          plural="marcas"
          genero="f"
          icono={Tags}
          placeholderNombre="Ej: Faber-Castell, Rivadavia, Maped"
        />
      </TabsContent>
    </Tabs>
  )
}

function CatalogoTab({
  tabla,
  items,
  singular,
  plural,
  genero,
  icono: Icono,
  placeholderNombre,
}: {
  tabla: Tabla
  items: CatalogoItemAdmin[]
  singular: string
  plural: string
  // Género gramatical para concordar "activas/activos" y participios.
  genero: 'f' | 'm'
  icono: ComponentType<{ className?: string }>
  placeholderNombre: string
}) {
  const [crearOpen, setCrearOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CatalogoItemAdmin | null>(null)

  const activos = items.filter((i) => i.activo)
  const inactivos = items.filter((i) => !i.activo)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icono className="size-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {activos.length} {plural} {genero === 'f' ? 'activas' : 'activos'}
            {inactivos.length > 0 &&
              ` · ${inactivos.length} ${genero === 'f' ? 'inactiva' : 'inactivo'}${inactivos.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setCrearOpen(true)}>
          <Plus className="size-4 mr-2" />
          Nueva {singular}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No hay {plural} {genero === 'f' ? 'cargadas' : 'cargados'}{' '}
              todavía. Creá {genero === 'f' ? 'la primera' : 'el primero'} para
              empezar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-16">Orden</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-24 text-center">Uso</TableHead>
                  <TableHead className="w-28">Estado</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn(!item.activo && 'opacity-60')}
                  >
                    <TableCell className="font-numeric text-xs text-muted-foreground">
                      {item.orden}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {item.nombre}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.uso_count > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {item.uso_count}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.activo ? (
                        <Badge
                          variant="outline"
                          className="text-xs border-success/40 bg-success/10 text-success"
                        >
                          <span className="size-1.5 rounded-full mr-1.5 bg-success" />
                          Activo
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          Inactivo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onSelect={() => setEditTarget(item)}
                          >
                            <Pencil className="size-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          {item.activo ? (
                            <DropdownMenuItem
                              onSelect={async () => {
                                const result = await setCatalogoItemActivo(
                                  tabla,
                                  item.id,
                                  false
                                )
                                if (!result.ok) toast.error(result.error)
                                else
                                  toast.success(
                                    `${singular} ${genero === 'f' ? 'desactivada' : 'desactivado'}`
                                  )
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <EyeOff className="size-4 mr-2" />
                              Desactivar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={async () => {
                                const result = await setCatalogoItemActivo(
                                  tabla,
                                  item.id,
                                  true
                                )
                                if (!result.ok) toast.error(result.error)
                                else
                                  toast.success(
                                    `${singular} ${genero === 'f' ? 'reactivada' : 'reactivado'}`
                                  )
                              }}
                              className="text-success focus:text-success"
                            >
                              <Eye className="size-4 mr-2" />
                              Reactivar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CrearItemDialog
        open={crearOpen}
        onOpenChange={setCrearOpen}
        tabla={tabla}
        singular={singular}
        genero={genero}
        placeholderNombre={placeholderNombre}
      />

      {editTarget && (
        <EditarItemDialog
          item={editTarget}
          tabla={tabla}
          singular={singular}
          genero={genero}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  )
}

function CrearItemDialog({
  open,
  onOpenChange,
  tabla,
  singular,
  genero,
  placeholderNombre,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tabla: Tabla
  singular: string
  genero: 'f' | 'm'
  placeholderNombre: string
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState('')
  const [orden, setOrden] = useState('0')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function reset() {
    setNombre('')
    setOrden('0')
    setErrors({})
  }

  function handleClose(v: boolean) {
    if (!v && !isPending) reset()
    onOpenChange(v)
  }

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await crearCatalogoItem({
        tabla,
        nombre,
        orden: parseInt(orden, 10) || 0,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      toast.success(`${singular} ${genero === 'f' ? 'creada' : 'creado'}`)
      handleClose(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva {singular}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={placeholderNombre}
              maxLength={50}
              disabled={isPending}
              autoFocus
            />
            {errors.nombre && <ErrorText msg={errors.nombre} />}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orden">Orden</Label>
            <Input
              id="orden"
              type="number"
              value={orden}
              onChange={(e) => setOrden(e.target.value)}
              disabled={isPending}
              className="font-numeric w-24"
            />
            <p className="text-[10px] text-muted-foreground">
              Más bajo = aparece primero. Empatados se ordenan alfabéticamente.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditarItemDialog({
  item,
  tabla,
  singular,
  genero,
  onClose,
}: {
  item: CatalogoItemAdmin
  tabla: Tabla
  singular: string
  genero: 'f' | 'm'
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState(item.nombre)
  const [orden, setOrden] = useState(String(item.orden))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await editarCatalogoItem({
        tabla,
        id: item.id,
        nombre,
        orden: parseInt(orden, 10) || 0,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      toast.success(`${singular} ${genero === 'f' ? 'actualizada' : 'actualizado'}`)
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar {singular}</DialogTitle>
          {item.uso_count > 0 && (
            <DialogDescription>
              Se usa en {item.uso_count}{' '}
              {item.uso_count === 1 ? 'producto' : 'productos'}. Cambiar el
              nombre puede afectar reportes históricos.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={50}
              disabled={isPending}
              autoFocus
            />
            {errors.nombre && <ErrorText msg={errors.nombre} />}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orden">Orden</Label>
            <Input
              id="orden"
              type="number"
              value={orden}
              onChange={(e) => setOrden(e.target.value)}
              disabled={isPending}
              className="font-numeric w-24"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ErrorText({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-destructive flex items-center gap-1">
      <AlertCircle className="size-3" />
      {msg}
    </p>
  )
}
