// src/app/(app)/admin/usuarios/_components/usuarios-view.tsx
'use client'

import { useState, useTransition } from 'react'
import {
  Plus,
  MoreHorizontal,
  UserCheck,
  UserX,
  KeyRound,
  Pencil,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { UsuarioListado } from '@/lib/queries/usuarios'
import {
  crearUsuario,
  editarUsuario,
  setUsuarioActivo,
  resetearPassword,
} from '../_actions/usuarios-actions'

type UserRole = 'admin' | 'vendedor' | 'superadmin'

function generarPassword(): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = lower + upper + digits + symbols
  let pwd = ''
  pwd += lower[Math.floor(Math.random() * lower.length)]
  pwd += upper[Math.floor(Math.random() * upper.length)]
  pwd += digits[Math.floor(Math.random() * digits.length)]
  pwd += symbols[Math.floor(Math.random() * symbols.length)]
  for (let i = 0; i < 8; i++) {
    pwd += all[Math.floor(Math.random() * all.length)]
  }
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

function rolLabel(rol: UserRole): string {
  switch (rol) {
    case 'superadmin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'vendedor':
      return 'Vendedor'
  }
}

function rolBadgeClass(rol: UserRole): string {
  switch (rol) {
    case 'superadmin':
      return 'border-warning/40 bg-warning/10 text-warning'
    case 'admin':
      return 'border-primary/40 bg-primary/10 text-primary'
    case 'vendedor':
      return 'border-border text-muted-foreground'
  }
}

function fechaCorta(fecha: string | null): string {
  if (!fecha) return 'Nunca'
  const d = new Date(fecha)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function UsuariosView({
  usuarios,
  callerId,
  callerRol,
}: {
  usuarios: UsuarioListado[]
  callerId: string
  callerRol: UserRole
}) {
  const [crearOpen, setCrearOpen] = useState(false)
  const [editarTarget, setEditarTarget] = useState<UsuarioListado | null>(null)
  const [resetTarget, setResetTarget] = useState<UsuarioListado | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<UsuarioListado | null>(
    null
  )

  const activos = usuarios.filter((u) => u.activo).length
  const inactivos = usuarios.length - activos

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold font-numeric">
                {usuarios.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Activos</p>
              <p className="text-2xl font-bold font-numeric text-success">
                {activos}
              </p>
            </CardContent>
          </Card>
          {inactivos > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Inactivos</p>
                <p className="text-2xl font-bold font-numeric text-muted-foreground">
                  {inactivos}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <Button onClick={() => setCrearOpen(true)} className="shrink-0">
          <Plus className="size-4 mr-2" />
          Nuevo usuario
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Último login</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => {
                const esElMismo = u.id === callerId
                return (
                  <TableRow
                    key={u.id}
                    className={cn(!u.activo && 'opacity-60')}
                  >
                    <TableCell className="font-medium text-sm">
                      {u.nombre_completo}
                      {esElMismo && (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[10px] py-0 px-1.5 h-4"
                        >
                          vos
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('text-xs', rolBadgeClass(u.rol))}
                      >
                        {rolLabel(u.rol)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-numeric">
                      {fechaCorta(u.ultimo_login_at)}
                    </TableCell>
                    <TableCell>
                      {u.activo ? (
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
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            onSelect={() => setEditarTarget(u)}
                            disabled={
                              u.rol === 'superadmin' &&
                              callerRol !== 'superadmin'
                            }
                          >
                            <Pencil className="size-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setResetTarget(u)}
                          >
                            <KeyRound className="size-4 mr-2" />
                            Resetear password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {u.activo ? (
                            <DropdownMenuItem
                              onSelect={() => setConfirmToggle(u)}
                              disabled={esElMismo}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserX className="size-4 mr-2" />
                              Desactivar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => setConfirmToggle(u)}
                              className="text-success focus:text-success"
                            >
                              <UserCheck className="size-4 mr-2" />
                              Reactivar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CrearUsuarioDialog
        open={crearOpen}
        onOpenChange={setCrearOpen}
        callerRol={callerRol}
      />

      {editarTarget && (
        <EditarUsuarioDialog
          usuario={editarTarget}
          callerId={callerId}
          callerRol={callerRol}
          onClose={() => setEditarTarget(null)}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          usuario={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {confirmToggle && (
        <ConfirmToggleDialog
          usuario={confirmToggle}
          onClose={() => setConfirmToggle(null)}
        />
      )}
    </>
  )
}

// ============================================================
// CREAR
// ============================================================

function CrearUsuarioDialog({
  open,
  onOpenChange,
  callerRol: _callerRol,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  callerRol: UserRole
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(generarPassword())
  const [rol, setRol] = useState<UserRole>('vendedor')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<{
    nombre: string
    email: string
    password: string
  } | null>(null)

  function reset() {
    setNombre('')
    setEmail('')
    setPassword(generarPassword())
    setRol('vendedor')
    setErrors({})
    setCreated(null)
  }

  function handleClose(v: boolean) {
    if (!v && !isPending) reset()
    onOpenChange(v)
  }

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await crearUsuario({
        nombre_completo: nombre,
        email,
        password,
        rol,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      setCreated({ nombre, email, password })
      toast.success('Usuario creado')
    })
  }

  function copiarCreds() {
    if (!created) return
    navigator.clipboard.writeText(
      `Nombre: ${created.nombre}\nEmail: ${created.email}\nPassword: ${created.password}`
    )
    toast.success('Credenciales copiadas')
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" />
                Usuario creado
              </DialogTitle>
              <DialogDescription>
                Guardá estas credenciales y mandalas al usuario. La password no
                se vuelve a mostrar.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="rounded-md bg-muted p-3 space-y-2 text-sm font-mono">
                <div>
                  <span className="text-muted-foreground text-xs">Nombre:</span>
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
                onClick={copiarCreds}
              >
                <Copy className="size-4 mr-2" />
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
              <DialogTitle>Nuevo usuario</DialogTitle>
              <DialogDescription>
                Se va a crear el usuario con las credenciales que ingreses.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="nombre">Nombre completo</Label>
                <Input
                  id="nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: María Pérez"
                  disabled={isPending}
                />
                {errors.nombre_completo && (
                  <ErrorText msg={errors.nombre_completo} />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  disabled={isPending}
                />
                {errors.email && <ErrorText msg={errors.email} />}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="flex gap-2">
                  <Input
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPassword(generarPassword())}
                    disabled={isPending}
                  >
                    Generar
                  </Button>
                </div>
                {errors.password && <ErrorText msg={errors.password} />}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rol">Rol</Label>
                <Select
                  value={rol}
                  onValueChange={(v) => setRol(v as UserRole)}
                  disabled={isPending}
                >
                  <SelectTrigger id="rol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
                </Select>
                {errors.rol && <ErrorText msg={errors.rol} />}
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// EDITAR
// ============================================================

function EditarUsuarioDialog({
  usuario,
  callerId,
  callerRol,
  onClose,
}: {
  usuario: UsuarioListado
  callerId: string
  callerRol: UserRole
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [nombre, setNombre] = useState(usuario.nombre_completo)
  const [rol, setRol] = useState<UserRole>(usuario.rol)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const esElMismo = usuario.id === callerId

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await editarUsuario({
        id: usuario.id,
        nombre_completo: nombre,
        rol,
      })
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      toast.success('Usuario actualizado')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
          <DialogDescription>{usuario.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="nombre">Nombre completo</Label>
            <Input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={isPending}
            />
            {errors.nombre_completo && (
              <ErrorText msg={errors.nombre_completo} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rol">Rol</Label>
            <Select
              value={rol}
              onValueChange={(v) => setRol(v as UserRole)}
              disabled={isPending || esElMismo}
            >
              <SelectTrigger id="rol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendedor">Vendedor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                {/* Solo mostramos Super Admin si el usuario YA es superadmin
                    (para que no se pierda la opción al editarlo) Y el caller
                    también lo es. Si no, los admins normales no deberían ni
                    enterarse de que existe ese rol. */}
                {callerRol === 'superadmin' && usuario.rol === 'superadmin' && (
                  <SelectItem value="superadmin">Super Admin</SelectItem>
                )}
              </SelectContent>
            </Select>
            {esElMismo && (
              <p className="text-[10px] text-muted-foreground">
                No podés cambiar tu propio rol.
              </p>
            )}
            {errors.rol && <ErrorText msg={errors.rol} />}
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

// ============================================================
// RESET PASSWORD
// ============================================================

function ResetPasswordDialog({
  usuario,
  onClose,
}: {
  usuario: UsuarioListado
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [password, setPassword] = useState(generarPassword())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)

  function handleSubmit() {
    setErrors({})
    startTransition(async () => {
      const result = await resetearPassword(usuario.id, password)
      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.error })
        else toast.error(result.error)
        return
      }
      setDone(true)
      toast.success('Password reseteada')
    })
  }

  function copiar() {
    navigator.clipboard.writeText(
      `Email: ${usuario.email}\nPassword: ${password}`
    )
    toast.success('Credenciales copiadas')
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-success" />
                Password reseteada
              </DialogTitle>
              <DialogDescription>
                Mandale estas credenciales al usuario.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md bg-muted p-3 space-y-2 text-sm font-mono">
              <div>
                <span className="text-muted-foreground text-xs">Email:</span>
                <div>{usuario.email}</div>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Password:</span>
                <div className="break-all">{password}</div>
              </div>
            </div>

            <Button variant="outline" onClick={copiar}>
              <Copy className="size-4 mr-2" />
              Copiar
            </Button>

            <DialogFooter>
              <Button onClick={onClose}>Cerrar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Resetear password</DialogTitle>
              <DialogDescription>
                Vas a generar una nueva password para{' '}
                <span className="font-medium text-foreground">
                  {usuario.nombre_completo}
                </span>{' '}
                ({usuario.email}). Las sesiones activas no se cierran
                automáticamente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 py-2">
              <Label htmlFor="new-password">Nueva password</Label>
              <div className="flex gap-2">
                <Input
                  id="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isPending}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPassword(generarPassword())}
                  disabled={isPending}
                >
                  Generar
                </Button>
              </div>
              {errors.password && <ErrorText msg={errors.password} />}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Resetear
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// CONFIRMAR DESACTIVAR/REACTIVAR
// ============================================================

function ConfirmToggleDialog({
  usuario,
  onClose,
}: {
  usuario: UsuarioListado
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const accion = usuario.activo ? 'desactivar' : 'reactivar'

  function handleConfirm() {
    startTransition(async () => {
      const result = await setUsuarioActivo(usuario.id, !usuario.activo)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Usuario ${accion === 'desactivar' ? 'desactivado' : 'reactivado'}`)
      onClose()
    })
  }

  return (
    <AlertDialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿{accion === 'desactivar' ? 'Desactivar' : 'Reactivar'} a{' '}
            {usuario.nombre_completo}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {accion === 'desactivar'
              ? 'No va a poder iniciar sesión hasta que lo reactives. Su historial de ventas se mantiene.'
              : 'Va a poder iniciar sesión nuevamente con sus credenciales actuales.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isPending}
            className={cn(
              accion === 'desactivar' &&
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            )}
          >
            {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            {accion === 'desactivar' ? 'Desactivar' : 'Reactivar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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