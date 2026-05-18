'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, RefreshCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { emitirFacturaAfip } from '../_actions/emitir-factura-afip'

type Props = {
  ventaId: string
  esReintento?: boolean
}

export function EmitirFacturaButton({ ventaId, esReintento = false }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await emitirFacturaAfip(ventaId)

      if (!result.ok) {
        toast.error(result.error)
        router.refresh()
        return
      }

      toast.success(`Factura emitida. CAE ${result.cae}`)
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      variant={esReintento ? 'outline' : 'default'}
    >
      {isPending ? (
        <>
          <Loader2 className="size-4 mr-2 animate-spin" />
          Emitiendo...
        </>
      ) : esReintento ? (
        <>
          <RefreshCcw className="size-4 mr-2" />
          Reintentar emisión
        </>
      ) : (
        <>
          <FileText className="size-4 mr-2" />
          Emitir factura
        </>
      )}
    </Button>
  )
}