'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { eliminarProducto } from '../_actions/eliminar-producto'

export function EliminarProductoButton({
  productoId,
}: {
  productoId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [razon, setRazon] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const razonValida = razon.trim().length > 0 && razon.trim().length <= 200

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return
    setOpen(next)
    if (!next) setRazon('')
  }

  async function handleConfirm() {
    if (!razonValida) return
    setIsSubmitting(true)
    try {
      const result = await eliminarProducto({ productoId, razon: razon.trim() })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      if (result.modo === 'hard') {
        toast.success('Producto eliminado definitivamente.')
        // El producto ya no existe: la pantalla de detalle quedaría 404.
        router.push('/admin/productos')
      } else {
        toast.success(
          `Producto archivado. No se pudo eliminar definitivamente porque tiene ${result.ventas} ${
            result.ventas === 1 ? 'venta registrada' : 'ventas registradas'
          }. Ya no aparece en el catálogo activo.`
        )
        // Sigue existiendo con activo=false: refrescamos el detalle.
        router.refresh()
      }
    } catch (error) {
      console.error(error)
      toast.error('Error inesperado')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 className="size-4 mr-2" />
        Eliminar
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminar producto</DialogTitle>
          <DialogDescription>
            Esta acción puede ser irreversible. El producto será eliminado o
            archivado según tenga ventas asociadas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="eliminar-producto-razon">Razón</Label>
          <Input
            id="eliminar-producto-razon"
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder="Ej: Producto cargado por error · Descontinuado"
            maxLength={200}
            autoFocus
            disabled={isSubmitting}
          />
          <p className="text-[11px] text-muted-foreground">
            Mínimo 1 carácter, máximo 200.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!razonValida || isSubmitting}
          >
            {isSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
            {isSubmitting ? 'Eliminando…' : 'Confirmar eliminación'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
