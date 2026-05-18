// src/app/(app)/admin/configuracion/_components/configuracion-form.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  Check,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Star,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import { NumericInput } from '@/components/app/numeric-input'
import type { Configuracion } from '@/lib/queries/configuracion-types'
import { actualizarConfiguracion } from '../_actions/actualizar-configuracion'
import { DatePicker } from '@/components/app/date-picker'

type Props = {
  initialData: Configuracion
}

type PuntoVentaItem = {
  id: string // id local solo para keys de React
  numero: number | null
}

function nuevoId() {
  return Math.random().toString(36).slice(2)
}

export function ConfiguracionForm({ initialData }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  // Estado local de los puntos de venta
  const [puntos, setPuntos] = useState<PuntoVentaItem[]>(() =>
    initialData.puntos_venta.map((n: number) => ({ id: nuevoId(), numero: n }))
  )

  function agregarPunto() {
    setPuntos((prev) => [...prev, { id: nuevoId(), numero: null }])
  }

  function quitarPunto(id: string) {
    setPuntos((prev) => {
      if (prev.length <= 1) {
        toast.error('Tiene que haber al menos un punto de venta')
        return prev
      }
      return prev.filter((p) => p.id !== id)
    })
  }

  function actualizarNumero(id: string, numero: number | null) {
    setPuntos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, numero } : p))
    )
  }

  function moverPunto(id: string, direccion: 'arriba' | 'abajo') {
    setPuntos((prev) => {
      const idx = prev.findIndex((p) => p.id === id)
      if (idx === -1) return prev
      const nuevoIdx = direccion === 'arriba' ? idx - 1 : idx + 1
      if (nuevoIdx < 0 || nuevoIdx >= prev.length) return prev
      const copia = [...prev]
      const tmp = copia[idx]
      copia[idx] = copia[nuevoIdx]
      copia[nuevoIdx] = tmp
      return copia
    })
  }

  function setComoDefault(id: string) {
    setPuntos((prev) => {
      const idx = prev.findIndex((p) => p.id === id)
      if (idx <= 0) return prev
      const copia = [...prev]
      const punto = copia.splice(idx, 1)[0]
      copia.unshift(punto)
      return copia
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFieldErrors({})

    const numerosValidos = puntos
      .map((p) => p.numero)
      .filter((n): n is number => n !== null && n >= 1)

    if (numerosValidos.length === 0) {
      toast.error('Tiene que haber al menos un punto de venta válido')
      return
    }

    // Validar duplicados
    const set = new Set(numerosValidos)
    if (set.size !== numerosValidos.length) {
      toast.error('No puede haber puntos de venta repetidos')
      return
    }

    const formData = new FormData(e.currentTarget)
    // Limpiar y agregar puntos_venta como múltiples values
    formData.delete('puntos_venta')
    for (const n of numerosValidos) {
      formData.append('puntos_venta', String(n))
    }
    // punto_venta_default queda sincronizado con el primero
    formData.set('punto_venta_default', String(numerosValidos[0]))

    startTransition(async () => {
      const result = await actualizarConfiguracion(formData)

      if (!result.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors)
        toast.error(result.error ?? 'Error al guardar')
        return
      }

      toast.success('Configuración guardada')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Datos fiscales */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Datos fiscales</h2>

          <Field label="Razón social" error={fieldErrors.razon_social} required>
            <Input
              name="razon_social"
              defaultValue={initialData.razon_social}
              onFocus={selectAllOnFocus}
              required
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="CUIT" error={fieldErrors.cuit} required>
              <Input
                name="cuit"
                defaultValue={initialData.cuit}
                onFocus={selectAllOnFocus}
                placeholder="30-12345678-9"
                className="font-numeric"
                required
              />
            </Field>

            <Field
              label="Condición frente al IVA"
              error={fieldErrors.condicion_iva}
              required
            >
              <Input
                name="condicion_iva"
                defaultValue={initialData.condicion_iva}
                onFocus={selectAllOnFocus}
                placeholder="IVA Responsable Inscripto"
                required
                maxLength={100}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Ingresos brutos" error={fieldErrors.ingresos_brutos}>
              <Input
                name="ingresos_brutos"
                defaultValue={initialData.ingresos_brutos ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="901-123456-7"
                className="font-numeric"
                maxLength={50}
              />
            </Field>

            <Field
              label="Inicio de actividades"
              error={fieldErrors.inicio_actividades}
            >
              <DatePicker
                name="inicio_actividades"
                defaultValue={initialData.inicio_actividades}
                placeholder="Elegir fecha"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Domicilio */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Domicilio fiscal</h2>

          <Field label="Calle y número" error={fieldErrors.domicilio}>
            <Input
              name="domicilio"
              defaultValue={initialData.domicilio ?? ''}
              onFocus={selectAllOnFocus}
              placeholder="Av. Mitre 1234"
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Localidad" error={fieldErrors.localidad}>
              <Input
                name="localidad"
                defaultValue={initialData.localidad ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="Avellaneda"
                maxLength={100}
              />
            </Field>

            <Field label="Provincia" error={fieldErrors.provincia}>
              <Input
                name="provincia"
                defaultValue={initialData.provincia ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="Buenos Aires"
                maxLength={100}
              />
            </Field>

            <Field label="Código postal" error={fieldErrors.codigo_postal}>
              <Input
                name="codigo_postal"
                defaultValue={initialData.codigo_postal ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="1870"
                className="font-numeric"
                maxLength={20}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Contacto */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Contacto</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Teléfono" error={fieldErrors.telefono}>
              <Input
                name="telefono"
                defaultValue={initialData.telefono ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="11 4523-7890"
                className="font-numeric"
                maxLength={50}
              />
            </Field>

            <Field label="Email" error={fieldErrors.email}>
              <Input
                type="email"
                name="email"
                defaultValue={initialData.email ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="ventas@empresa.com"
                maxLength={100}
              />
            </Field>
          </div>

          <Field label="Web" error={fieldErrors.web}>
            <Input
              name="web"
              defaultValue={initialData.web ?? ''}
              onFocus={selectAllOnFocus}
              placeholder="www.empresa.com"
              maxLength={200}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Inventario */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Inventario</h2>

          <Field
            label="Umbral de stock bajo"
            error={fieldErrors.umbral_stock_bajo}
          >
            <Input
              type="number"
              name="umbral_stock_bajo"
              defaultValue={initialData.umbral_stock_bajo}
              onFocus={selectAllOnFocus}
              min={0}
              max={9999}
              className="font-numeric w-32"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Las variantes con stock por debajo de este número aparecen
              marcadas como &quot;stock bajo&quot; en el listado de productos
              y reportes. Default: 5.
            </p>
          </Field>
        </CardContent>
      </Card>

      {/* Facturación / Puntos de venta */}

      {/* Facturación / Puntos de venta */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Puntos de venta AFIP</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cada punto de venta registrado en AFIP. El primero es el
                que se usa por defecto al emitir factura.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {puntos.map((punto, index) => {
              const esDefault = index === 0
              const esPrimero = index === 0
              const esUltimo = index === puntos.length - 1

              return (
                <div
                  key={punto.id}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-md border transition-colors duration-200',
                    esDefault
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-muted/20'
                  )}
                >
                  {/* Numero del punto */}
                  <div className="w-32 shrink-0">
                    <NumericInput
                      value={punto.numero}
                      onChange={(v) => actualizarNumero(punto.id, v)}
                      decimals={0}
                      min={1}
                      max={99999}
                      allowEmpty
                      placeholder="Nº"
                      className="text-center font-numeric font-semibold"
                    />
                  </div>

                  {/* Badge default */}
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    {esDefault ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 px-1.5 text-primary border-primary/40 bg-primary/10"
                      >
                        <Star className="size-2.5 mr-1 fill-current" />
                        Default
                      </Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setComoDefault(punto.id)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 underline-offset-2 hover:underline"
                      >
                        Marcar como default
                      </button>
                    )}
                  </div>

                  {/* Reordenar */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moverPunto(punto.id, 'arriba')}
                      disabled={esPrimero}
                      title="Mover arriba"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moverPunto(punto.id, 'abajo')}
                      disabled={esUltimo}
                      title="Mover abajo"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>

                  {/* Eliminar */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => quitarPunto(punto.id)}
                    disabled={puntos.length <= 1}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    title="Quitar punto de venta"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregarPunto}
            className="w-full"
          >
            <Plus className="size-3.5 mr-1.5" />
            Agregar punto de venta
          </Button>

          {fieldErrors.puntos_venta && (
            <p className="text-xs text-destructive">
              {fieldErrors.puntos_venta[0]}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Check className="size-4 mr-2" />
              Guardar cambios
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label?: string
  error?: string[]
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <Label
          className={cn(
            'text-sm',
            required && "after:content-['*'] after:ml-0.5 after:text-destructive"
          )}
        >
          {label}
        </Label>
      )}
      {children}
      {error && error.length > 0 && (
        <p className="text-xs text-destructive">{error[0]}</p>
      )}
    </div>
  )
}