// src/app/(app)/admin/pedidos/[id]/_components/asignar-cliente-inline.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { asignarClienteBulk } from '../../_actions/asignar-cliente-bulk'
import type { ClienteCaja } from '@/lib/queries/clientes-caja'

type Props = {
  pedidoId: string
  clientes: ClienteCaja[]
  clienteIdActual: string | null
}

const SIN_CLIENTE = '__sin_cliente__'

export function AsignarClienteInline({
  pedidoId,
  clientes,
  clienteIdActual,
}: Props) {
  const router = useRouter()
  const [valor, setValor] = useState<string>(clienteIdActual ?? SIN_CLIENTE)
  const [isPending, startTransition] = useTransition()

  const hayCambio = valor !== (clienteIdActual ?? SIN_CLIENTE)

  function guardar() {
    const clienteId = valor === SIN_CLIENTE ? null : valor

    startTransition(async () => {
      const result = await asignarClienteBulk([pedidoId], clienteId)
      if (!result.ok) {
        const msg = result.fallidos[0]?.error ?? 'No se pudo asignar el cliente'
        toast.error(msg)
        return
      }
      toast.success(
        clienteId ? 'Cliente asignado' : 'Cliente desasignado'
      )
      router.refresh()
    })
  }

  function descartar() {
    setValor(clienteIdActual ?? SIN_CLIENTE)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={valor} onValueChange={setValor} disabled={isPending}>
        <SelectTrigger className="h-9 w-full sm:w-72">
          <SelectValue placeholder="Seleccionar cliente" />
        </SelectTrigger>
        <SelectContent className="no-scrollbar">
          <SelectItem value={SIN_CLIENTE}>
            <span className="italic text-muted-foreground">Sin cliente</span>
          </SelectItem>
          {clientes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.razon_social}
              {c.cuit && (
                <span className="text-muted-foreground font-numeric">
                  {' '}
                  · {c.cuit}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hayCambio && (
        <>
          <Button
            type="button"
            size="sm"
            onClick={guardar}
            disabled={isPending}
          >
            <Check className="size-4 mr-1" />
            {isPending ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={descartar}
            disabled={isPending}
          >
            <X className="size-4" />
          </Button>
        </>
      )}
    </div>
  )
}
