'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { cambiarEstadoProducto } from '../[id]/_actions/cambiar-estado'
type Props = {
  productoId: string
  activoInicial: boolean
}
export function ActivoToggle({ productoId, activoInicial }: Props) {
  const [activo, setActivo] = useState(activoInicial)
  const [isSaving, setIsSaving] = useState(false)
  async function handleToggle(nuevoEstado: boolean) {
    setIsSaving(true)
    const anterior = activo
    setActivo(nuevoEstado)
    const result = await cambiarEstadoProducto(productoId, nuevoEstado)
    setIsSaving(false)
    if (!result.ok) {
      setActivo(anterior)
      toast.error(result.error)
    } else {
      toast.success(nuevoEstado ? 'Producto activado' : 'Producto desactivado')
    }
  }
  return (
    <Switch
      size="sm"
      checked={activo}
      onCheckedChange={handleToggle}
      disabled={isSaving}
      aria-label={activo ? 'Desactivar producto' : 'Activar producto'}
    />
  )
}
