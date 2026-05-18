// src/app/superadmin/_components/empresa-card.tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowRight,
  Loader2,
  MoreHorizontal,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { entrarAEmpresa } from '../_actions/empresa-impersonacion'
import {
  desactivarEmpresa,
  obtenerInfoDesactivacion,
  type InfoDesactivacion,
} from '../_actions/desactivar-empresa'
import type { EmpresaConStats } from '../page'

function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function SubmitInner({ empresa }: { empresa: EmpresaConStats }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="w-full text-left group focus:outline-none focus:ring-2 focus:ring-ring rounded-md disabled:cursor-not-allowed"
      disabled={!empresa.activo || pending}
    >
      <div
        className="flex items-start justify-between gap-2 group-hover:[&:not(:disabled)]:text-primary transition-colors"
        data-pending={pending}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{empresa.nombre}</h3>
            {!empresa.activo && (
              <Badge variant="outline" className="text-[10px]">
                Desactivada
              </Badge>
            )}
            {empresa.lista_para_eliminacion && (
              <Badge variant="outline" className="text-[10px] font-medium">
                Lista para eliminación
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-numeric truncate">
            {empresa.slug}
          </p>
        </div>
        {empresa.activo &&
          (pending ? (
            <Loader2 className="size-4 text-primary shrink-0 animate-spin" />
          ) : (
            <ArrowRight className="size-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
          ))}
      </div>
    </button>
  )
}

export function EmpresaCard({ empresa }: { empresa: EmpresaConStats }) {
  const [desactivarOpen, setDesactivarOpen] = useState(false)

  return (
    <>
      <Card
        className={
          empresa.activo
            ? 'transition-all duration-200 hover:border-primary/40 hover:shadow-sm'
            : 'opacity-70'
        }
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <form
              action={entrarAEmpresa.bind(null, empresa.id)}
              className="flex-1 min-w-0"
            >
              <SubmitInner empresa={empresa} />
            </form>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Acciones"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {empresa.activo ? (
                  <DropdownMenuItem
                    onSelect={() => setDesactivarOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4 mr-2" />
                    Desactivar empresa
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>
                    <CheckCircle2 className="size-4 mr-2" />
                    Empresa desactivada
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-4 pt-2 border-t border-border/50 text-xs text-muted-foreground">
            <div>
              <span className="font-numeric font-medium text-foreground">
                {empresa.total_usuarios}
              </span>{' '}
              usuarios
            </div>
            <div>
              <span className="font-numeric font-medium text-foreground">
                {empresa.total_productos}
              </span>{' '}
              productos
            </div>
            <div>
              <span className="font-numeric font-medium text-foreground">
                {empresa.total_ventas}
              </span>{' '}
              ventas
            </div>
          </div>

          {!empresa.activo && (
            <div className="pt-2 border-t border-border/50 text-[11px] text-muted-foreground space-y-1">
              <div>
                Desactivada el{' '}
                <span className="font-numeric">
                  {fechaCorta(empresa.eliminada_at)}
                </span>
              </div>
              {empresa.facturas_afip_aprobadas > 0 &&
                empresa.eliminacion_definitiva_en && (
                  <div>
                    Eliminación definitiva habilitada el{' '}
                    <span className="font-numeric">
                      {fechaCorta(empresa.eliminacion_definitiva_en)}
                    </span>{' '}
                    (RG 4290)
                  </div>
                )}
              {empresa.lista_para_eliminacion && (
                <div className="flex items-center gap-1.5 pt-1 font-medium text-foreground">
                  <CheckCircle2 className="size-3" />
                  Lista para eliminación definitiva
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {desactivarOpen && (
        <DesactivarEmpresaDialog
          empresa={empresa}
          onClose={() => setDesactivarOpen(false)}
        />
      )}
    </>
  )
}

function DesactivarEmpresaDialog({
  empresa,
  onClose,
}: {
  empresa: EmpresaConStats
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmacion, setConfirmacion] = useState('')
  const [info, setInfo] = useState<InfoDesactivacion | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

  useEffect(() => {
    let cancelled = false
    obtenerInfoDesactivacion(empresa.id).then((res) => {
      if (cancelled) return
      if (res.ok) setInfo(res.info)
      else toast.error(res.error)
      setLoadingInfo(false)
    })
    return () => {
      cancelled = true
    }
  }, [empresa.id])

  const coincide = confirmacion.trim() === empresa.nombre
  const tieneFacturas = (info?.facturasAprobadasCount ?? 0) > 0

  function handleSubmit() {
    if (!coincide) return
    startTransition(async () => {
      const result = await desactivarEmpresa({
        empresaId: empresa.id,
        confirmacionNombre: confirmacion,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`${empresa.nombre} fue desactivada`)
      router.refresh()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Desactivar empresa
          </DialogTitle>
          <DialogDescription>
            Esta acción es destructiva. Los usuarios de{' '}
            <span className="font-semibold text-foreground">
              {empresa.nombre}
            </span>{' '}
            no van a poder iniciar sesión. Los datos quedan intactos para
            conservación fiscal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {loadingInfo ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              Verificando facturas AFIP…
            </div>
          ) : tieneFacturas ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                {info?.facturasAprobadasCount} factura
                {info?.facturasAprobadasCount === 1 ? '' : 's'} AFIP emitida
                {info?.facturasAprobadasCount === 1 ? '' : 's'}
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Por RG 4290 (conservación fiscal 10 años) no se puede eliminar
                definitivamente hasta el{' '}
                <span className="font-numeric font-medium text-foreground">
                  {fechaCorta(info?.eliminacionDefinitivaEn ?? null)}
                </span>
                . Por ahora se va a desactivar (oculta de UI, datos intactos).
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Sin facturas AFIP emitidas — se puede desactivar y eliminar
              definitivamente sin restricción fiscal.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="confirmacion" className="text-xs">
              Para confirmar, escribí el nombre exacto:{' '}
              <span className="font-mono text-foreground">{empresa.nombre}</span>
            </Label>
            <Input
              id="confirmacion"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              disabled={isPending}
              placeholder={empresa.nombre}
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !coincide}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            Desactivar empresa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
