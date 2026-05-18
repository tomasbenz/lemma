// src/app/(app)/admin/catalogos/_components/catalogos-view.tsx
'use client'

import { useState, useTransition } from 'react'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Ruler,
  Palette,
  FolderTree,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
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
import { cn } from '@/lib/utils'
import type { CatalogoItemAdmin } from '@/lib/queries/catalogos'
import {
  crearCatalogoItem,
  editarCatalogoItem,
  setCatalogoItemActivo,
} from '../_actions/catalogos-actions'

type Tabla = 'catalogo_colores' | 'catalogo_talles' | 'catalogo_categorias'

export function CatalogosView({
  colores,
  talles,
  categorias,
}: {
  colores: CatalogoItemAdmin[]
  talles: CatalogoItemAdmin[]
  categorias: CatalogoItemAdmin[]
}) {
  return (
    <Tabs defaultValue="categorias" className="space-y-4">
      <TabsList>
        <TabsTrigger value="categorias" className="gap-2">
          <FolderTree className="size-4" />
          Categorías ({categorias.filter((c) => c.activo).length})
        </TabsTrigger>
        <TabsTrigger value="talles" className="gap-2">
          <Ruler className="size-4" />
          Talles ({talles.filter((t) => t.activo).length})
        </TabsTrigger>
        <TabsTrigger value="colores" className="gap-2">
          <Palette className="size-4" />
          Colores ({colores.filter((c) => c.activo).length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="categorias">
        <CatalogoTab
          tabla="catalogo_categorias"
          items={categorias}
          singular="categoría"
          plural="categorías"
          tieneHex={false}
          placeholderNombre="Ej: Pollera, Top, Vestido, Accesorio"
        />
      </TabsContent>

      <TabsContent value="talles">
        <CatalogoTab
          tabla="catalogo_talles"
          items={talles}
          singular="talle"
          plural="talles"
          tieneHex={false}
          placeholderNombre="Ej: M, L, 38, 40"
        />
      </TabsContent>

      <TabsContent value="colores">
        <CatalogoTab
          tabla="catalogo_colores"
          items={colores}
          singular="color"
          plural="colores"
          tieneHex={true}
          placeholderNombre="Ej: Negro, Bordó, Azul francia"
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
  tieneHex,
  placeholderNombre,
}: {
  tabla: Tabla
  items: CatalogoItemAdmin[]
  singular: string
  plural: string
  tieneHex: boolean
  placeholderNombre: string
}) {
  const [crearOpen, setCrearOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CatalogoItemAdmin | null>(null)

  const activos = items.filter((i) => i.activo)
  const inactivos = items.filter((i) => !i.activo)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          {activos.length}{' '}
          {activos.length === 1
            ? `${singular} ${singular.endsWith('a') ? 'activa' : 'activo'}`
            : `${plural} ${plural.endsWith('s') ? (plural.endsWith('as') ? 'activas' : 'activos') : 'activos'}`}
          {inactivos.length > 0 &&
            ` · ${inactivos.length} ${inactivos.length === 1 ? 'inactivo' : 'inactivos'}`}
        </p>
        <Button size="sm" onClick={() => setCrearOpen(true)}>
          <Plus className="size-4 mr-2" />
          Nueva {singular}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No hay {plural} cargados todavía. Creá la primera para empezar.
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
                  {tieneHex && <TableHead className="w-20">Color</TableHead>}
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
                    {tieneHex && (
                      <TableCell>
                        {item.hex ? (
                          <div className="flex items-center gap-1.5">
                            <div
                              className="size-5 rounded border border-border shrink-0"
                              style={{ backgroundColor: item.hex }}
                              title={item.hex}
                            />
                            <span className="text-[10px] font-numeric text-muted-foreground">
                              {item.hex}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    )}
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
                                else toast.success(`${singular} desactivado`)
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
                                else toast.success(`${singular} reactivado`)
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
        tieneHex={tieneHex}
        placeholderNombre={placeholderNombre}
      />

      {editTarget && (
        <EditarItemDialog
          item={editTarget}
          tabla={tabla}
          singular={singular}
          tieneHex={tieneHex}
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
  tieneHex,
  placeholderNombre,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tabla: Tabla
  singular: string
  tieneHex: boolean
  placeholderNombre: string
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState('')
  const [hex, setHex] = useState('#000000')
  const [usaHex, setUsaHex] = useState(false)
  const [orden, setOrden] = useState('0')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function reset() {
    setNombre('')
    setHex('#000000')
    setUsaHex(false)
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
        hex: tieneHex && usaHex ? hex : null,
        orden: parseInt(orden, 10) || 0,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      toast.success(`${singular} creado`)
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

          {tieneHex && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="hex">Color (opcional)</Label>
                <button
                  type="button"
                  onClick={() => setUsaHex(!usaHex)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {usaHex ? 'Quitar' : 'Agregar'}
                </button>
              </div>
              {usaHex && (
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    disabled={isPending}
                    className="size-10 rounded border border-border cursor-pointer shrink-0"
                  />
                  <Input
                    id="hex"
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    placeholder="#000000"
                    maxLength={7}
                    disabled={isPending}
                    className="font-numeric"
                  />
                </div>
              )}
              {errors.hex && <ErrorText msg={errors.hex} />}
            </div>
          )}

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
  tieneHex,
  onClose,
}: {
  item: CatalogoItemAdmin
  tabla: Tabla
  singular: string
  tieneHex: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState(item.nombre)
  const [hex, setHex] = useState(item.hex ?? '#000000')
  const [usaHex, setUsaHex] = useState(!!item.hex)
  const [orden, setOrden] = useState(String(item.orden))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await editarCatalogoItem({
        tabla,
        id: item.id,
        nombre,
        hex: tieneHex && usaHex ? hex : null,
        orden: parseInt(orden, 10) || 0,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      toast.success(`${singular} actualizado`)
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
              {tabla === 'catalogo_categorias'
                ? item.uso_count === 1
                  ? 'producto'
                  : 'productos'
                : item.uso_count === 1
                  ? 'variante'
                  : 'variantes'}
              . Cambiar el nombre puede afectar reportes históricos.
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

          {tieneHex && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="hex">Color (opcional)</Label>
                <button
                  type="button"
                  onClick={() => setUsaHex(!usaHex)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {usaHex ? 'Quitar' : 'Agregar'}
                </button>
              </div>
              {usaHex && (
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    disabled={isPending}
                    className="size-10 rounded border border-border cursor-pointer shrink-0"
                  />
                  <Input
                    id="hex"
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    placeholder="#000000"
                    maxLength={7}
                    disabled={isPending}
                    className="font-numeric"
                  />
                </div>
              )}
              {errors.hex && <ErrorText msg={errors.hex} />}
            </div>
          )}

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