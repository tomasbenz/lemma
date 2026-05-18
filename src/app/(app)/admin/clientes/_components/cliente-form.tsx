'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { selectAllOnFocus } from '@/lib/utils/select-all-on-focus'
import type { Cliente, CondIva } from '@/lib/queries/clientes-types'
import { labelCondIva } from '@/lib/queries/clientes-types'

type Props = {
  initialData?: Cliente
  onSubmit: (formData: FormData) => Promise<{
    ok: boolean
    error?: string
    fieldErrors?: Record<string, string[]>
    clienteId?: string
  }>
  submitLabel?: string
  redirectOnSuccess?: string
}

export function ClienteForm({
  initialData,
  onSubmit,
  submitLabel = 'Crear cliente',
  redirectOnSuccess,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [condIva, setCondIva] = useState<CondIva>(
    initialData?.cond_iva ?? 'RI'
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFieldErrors({})

    const formData = new FormData(e.currentTarget)
    // Asegurar que el cond_iva se envíe (Select usa state, no input nativo)
    formData.set('cond_iva', condIva)

    startTransition(async () => {
      const result = await onSubmit(formData)

      if (!result.ok) {
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors)
        }
        toast.error(result.error ?? 'Error al guardar')
        return
      }

      toast.success(
        initialData ? 'Cliente actualizado' : 'Cliente creado correctamente'
      )

      if (redirectOnSuccess) {
        router.push(redirectOnSuccess)
      } else if (result.clienteId) {
        router.push(`/admin/clientes/${result.clienteId}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Datos principales */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Datos principales</h2>

          <Field label="Razón social" error={fieldErrors.razon_social} required>
            <Input
              name="razon_social"
              defaultValue={initialData?.razon_social}
              onFocus={selectAllOnFocus}
              placeholder="Ej: Indumentaria Laura SRL"
              required
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Condición frente al IVA"
              error={fieldErrors.cond_iva}
              required
            >
              <Select
                value={condIva}
                onValueChange={(v) => setCondIva(v as CondIva)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['RI', 'MONO', 'CF', 'EX'] as CondIva[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {labelCondIva(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="CUIT" error={fieldErrors.cuit}>
              <Input
                name="cuit"
                defaultValue={initialData?.cuit ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="30-12345678-9"
                className="font-numeric"
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
            <Field label="Email" error={fieldErrors.email}>
              <Input
                type="email"
                name="email"
                defaultValue={initialData?.email ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="contacto@empresa.com"
                maxLength={100}
              />
            </Field>

            <Field label="Teléfono" error={fieldErrors.telefono}>
              <Input
                name="telefono"
                defaultValue={initialData?.telefono ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="11 4523-7890"
                className="font-numeric"
                maxLength={50}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Dirección */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Dirección</h2>

          <Field label="Domicilio" error={fieldErrors.domicilio}>
            <Input
              name="domicilio"
              defaultValue={initialData?.domicilio ?? ''}
              onFocus={selectAllOnFocus}
              placeholder="Ej: Av. Avellaneda 2340"
              maxLength={200}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Localidad" error={fieldErrors.localidad}>
              <Input
                name="localidad"
                defaultValue={initialData?.localidad ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="Ej: Avellaneda"
                maxLength={100}
              />
            </Field>

            <Field label="Provincia" error={fieldErrors.provincia}>
              <Input
                name="provincia"
                defaultValue={initialData?.provincia ?? ''}
                onFocus={selectAllOnFocus}
                placeholder="Ej: Buenos Aires"
                maxLength={100}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Notas */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-medium">Notas internas</h2>
          <Field error={fieldErrors.notas}>
            <Textarea
              name="notas"
              defaultValue={initialData?.notas ?? ''}
              onFocus={selectAllOnFocus}
              placeholder="Información adicional del cliente (solo visible para administradores)"
              rows={3}
              maxLength={1000}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          asChild
          disabled={isPending}
        >
          <Link href="/admin/clientes">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Check className="size-4 mr-2" />
              {submitLabel}
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
        <Label className={cn('text-sm', required && "after:content-['*'] after:ml-0.5 after:text-destructive")}>
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