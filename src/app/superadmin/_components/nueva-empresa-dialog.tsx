// src/app/superadmin/_components/nueva-empresa-dialog.tsx
'use client'

import { useState, useTransition } from 'react'
import { Plus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { crearEmpresa } from '../_actions/crear-empresa'

/**
 * Slugify simple: minúsculas, espacios → guiones, sin acentos ni caracteres raros.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Genera password fuerte: 12 chars con mayús/minús/números/símbolos.
 */
function generarPassword(): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = lower + upper + digits + symbols

  // Asegurar al menos 1 de cada
  let pwd = ''
  pwd += lower[Math.floor(Math.random() * lower.length)]
  pwd += upper[Math.floor(Math.random() * upper.length)]
  pwd += digits[Math.floor(Math.random() * digits.length)]
  pwd += symbols[Math.floor(Math.random() * symbols.length)]
  for (let i = 0; i < 8; i++) {
    pwd += all[Math.floor(Math.random() * all.length)]
  }
  // Shuffle
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

export function NuevaEmpresaDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [created, setCreated] = useState<{
    nombre: string
    email: string
    password: string
  } | null>(null)

  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState(generarPassword())
  const [adminNombre, setAdminNombre] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function reset() {
    setNombre('')
    setSlug('')
    setSlugManual(false)
    setAdminEmail('')
    setAdminPassword(generarPassword())
    setAdminNombre('')
    setErrors({})
    setCreated(null)
  }

  function handleNombreChange(value: string) {
    setNombre(value)
    if (!slugManual) {
      setSlug(slugify(value))
    }
  }

  function handleSubmit() {
    setErrors({})

    startTransition(async () => {
      const result = await crearEmpresa({
        nombre,
        slug,
        adminEmail,
        adminPassword,
        adminNombre,
      })

      if (!result.ok) {
        if (result.field) {
          setErrors({ [result.field]: result.error })
        } else {
          toast.error(result.error)
        }
        return
      }

      // Éxito: mostrar credenciales para que el superadmin las copie
      setCreated({
        nombre,
        email: adminEmail,
        password: adminPassword,
      })
      router.refresh()
    })
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && !isPending) {
      reset()
    }
    setOpen(nextOpen)
  }

  function copiarCredenciales() {
    if (!created) return
    const text = `Empresa: ${created.nombre}\nEmail: ${created.email}\nPassword: ${created.password}`
    navigator.clipboard.writeText(text)
    toast.success('Credenciales copiadas')
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4 mr-2" />
          Nueva empresa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" />
                Empresa creada
              </DialogTitle>
              <DialogDescription>
                Guardá estas credenciales y mandalas al cliente. No se vuelven a
                mostrar.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="rounded-md bg-muted p-3 space-y-2 text-sm font-mono">
                <div>
                  <span className="text-muted-foreground text-xs">
                    Empresa:
                  </span>
                  <div className="font-semibold">{created.nombre}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Email:</span>
                  <div>{created.email}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    Password:
                  </span>
                  <div className="break-all">{created.password}</div>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={copiarCredenciales}
              >
                Copiar credenciales
              </Button>
            </div>

            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Cerrar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nueva empresa</DialogTitle>
              <DialogDescription>
                Se va a crear la empresa y un usuario admin inicial. Después el
                admin puede crear vendedores desde la app.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="nombre">Nombre de la empresa</Label>
                <Input
                  id="nombre"
                  value={nombre}
                  onChange={(e) => handleNombreChange(e.target.value)}
                  placeholder="Ej: Tienda Vera"
                  disabled={isPending}
                />
                {errors.nombre && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="size-3" />
                    {errors.nombre}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug (URL)</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlug(slugify(e.target.value))
                    setSlugManual(true)
                  }}
                  placeholder="tienda-vera"
                  disabled={isPending}
                  className="font-mono text-sm"
                />
                {errors.slug && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="size-3" />
                    {errors.slug}
                  </p>
                )}
              </div>

              <div className="border-t pt-3 mt-3 space-y-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Usuario admin inicial
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adminNombre">Nombre del admin</Label>
                  <Input
                    id="adminNombre"
                    value={adminNombre}
                    onChange={(e) => setAdminNombre(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    disabled={isPending}
                  />
                  {errors.adminNombre && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      {errors.adminNombre}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adminEmail">Email del admin</Label>
                  <Input
                    id="adminEmail"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@empresa.com"
                    disabled={isPending}
                  />
                  {errors.adminEmail && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      {errors.adminEmail}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="adminPassword">Password del admin</Label>
                  <div className="flex gap-2">
                    <Input
                      id="adminPassword"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      disabled={isPending}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAdminPassword(generarPassword())}
                      disabled={isPending}
                    >
                      Generar
                    </Button>
                  </div>
                  {errors.adminPassword && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      {errors.adminPassword}
                    </p>
                  )}
                </div>
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
                Crear empresa
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}