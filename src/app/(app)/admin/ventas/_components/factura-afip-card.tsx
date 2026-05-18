import {
  FileCheck2,
  FileX,
  FileClock,
  AlertTriangle,
  Download,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type {
  FacturaAfip,
  FacturaAfipConNc,
} from '@/lib/queries/facturas-afip'
import { EmitirFacturaButton } from './emitir-factura-button'

type Props = {
  ventaId: string
  tipoFactura: 'sin_factura' | 'factura_a' | 'factura_b' | 'factura_c'
  factura: FacturaAfipConNc | null
  ventaAnulada: boolean
}

function formatearFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatearComprobante(puntoVenta: number, numero: number): string {
  const pv = puntoVenta.toString().padStart(4, '0')
  const nro = numero.toString().padStart(8, '0')
  return `${pv}-${nro}`
}

export function FacturaAfipCard({
  ventaId,
  tipoFactura,
  factura,
  ventaAnulada,
}: Props) {
  // Si la venta no requiere factura, no mostramos nada
  if (tipoFactura === 'sin_factura') return null

  // Renombre de label heredado de T2 (PDF). El enum interno sigue siendo
  // 'factura_c' pero AFIP lo emite como Factura B (cbteTipo 6).
  const tipoLabel = tipoFactura === 'factura_a' ? 'Factura A' : 'Factura B'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileCheck2 className="size-4 text-muted-foreground" />
          Comprobante AFIP — {tipoLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!factura && !ventaAnulada && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Esta venta requiere factura pero aún no fue emitida en AFIP.
            </p>
            <EmitirFacturaButton ventaId={ventaId} />
          </div>
        )}

        {!factura && ventaAnulada && (
          <p className="text-sm text-muted-foreground italic">
            Esta venta fue anulada antes de emitir el comprobante.
          </p>
        )}

        {factura?.original.estado === 'aprobada' && (
          <FacturaAprobada factura={factura.original} ventaId={ventaId} />
        )}

        {factura?.original.estado === 'rechazada' && (
          <FacturaRechazada
            ventaId={ventaId}
            factura={factura.original}
            puedeReintentar={!ventaAnulada}
          />
        )}

        {factura?.original.estado === 'pendiente' && <FacturaPendiente />}

        {factura?.original.estado === 'anulada_por_nc' && (
          <FacturaAnuladaPorNc
            factura={factura.original}
            notaCredito={factura.notaCredito}
            ventaId={ventaId}
          />
        )}
      </CardContent>
    </Card>
  )
}

function FacturaAprobada({
  factura,
  ventaId,
}: {
  factura: FacturaAfip
  ventaId: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs text-success bg-success/10 border-success/40"
          >
            <FileCheck2 className="size-3 mr-1" />
            Aprobada
          </Badge>
          {factura.numero_comprobante && (
            <span className="text-sm font-numeric text-muted-foreground">
              Nº {formatearComprobante(factura.punto_venta, factura.numero_comprobante)}
            </span>
          )}
        </div>

        <Button variant="outline" size="sm" asChild>
          <a
            href={`/api/ventas/${ventaId}/factura-pdf`}
            target="_blank"
            rel="noopener"
          >
            <Download className="size-3.5 mr-1.5" />
            Descargar PDF
          </a>
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">CAE</p>
          <p className="font-numeric font-medium tracking-wider">
            {factura.cae}
          </p>
        </div>
        {factura.cae_vencimiento && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">
              Vencimiento CAE
            </p>
            <p className="font-medium">
              {formatearFecha(factura.cae_vencimiento)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function FacturaRechazada({
  ventaId,
  factura,
  puedeReintentar,
}: {
  ventaId: string
  factura: FacturaAfip
  puedeReintentar: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-xs text-destructive bg-destructive/10 border-destructive/40"
        >
          <FileX className="size-3 mr-1" />
          Rechazada
        </Badge>
        <span className="text-xs text-muted-foreground">
          Intento #{factura.intentos}
        </span>
      </div>

      <div
        className={cn(
          'rounded-md border p-3 text-sm',
          'border-destructive/40 bg-destructive/5'
        )}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium mb-0.5">
              AFIP rechazó el comprobante
            </p>
            <p className="text-muted-foreground text-xs">
              {factura.error_mensaje ?? 'Sin detalle'}
            </p>
          </div>
        </div>
      </div>

      {puedeReintentar && (
        <div className="flex justify-end">
          <EmitirFacturaButton ventaId={ventaId} esReintento />
        </div>
      )}
    </div>
  )
}

function FacturaPendiente() {
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className="text-xs text-warning bg-warning/10 border-warning/40"
      >
        <FileClock className="size-3 mr-1" />
        Pendiente
      </Badge>
      <span className="text-xs text-muted-foreground">
        Emisión en curso…
      </span>
    </div>
  )
}

function FacturaAnuladaPorNc({
  factura,
  notaCredito,
  ventaId,
}: {
  factura: FacturaAfip
  notaCredito: FacturaAfip | null
  ventaId: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className="text-xs text-muted-foreground bg-muted border-border"
        >
          <FileX className="size-3 mr-1" />
          Anulada por Nota de Crédito
        </Badge>
        {factura.numero_comprobante && (
          <span className="text-sm font-numeric text-muted-foreground line-through">
            Nº {formatearComprobante(factura.punto_venta, factura.numero_comprobante)}
          </span>
        )}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          Nota de Crédito que anuló esta factura
        </p>
        {notaCredito ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">
                {notaCredito.tipo_factura === 'nota_credito_a' ? 'NC A' : 'NC B'}
              </span>
              {notaCredito.numero_comprobante && (
                <span className="font-numeric text-muted-foreground">
                  Nº {formatearComprobante(notaCredito.punto_venta, notaCredito.numero_comprobante)}
                </span>
              )}
            </div>
            {notaCredito.cae && (
              <p className="text-xs">
                <span className="text-muted-foreground">CAE: </span>
                <span className="font-numeric">{notaCredito.cae}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground italic text-xs">
            No se encontró la NC asociada
          </p>
        )}
      </div>

      <Button variant="outline" size="sm" asChild>
        <a
          href={`/api/ventas/${ventaId}/factura-pdf`}
          target="_blank"
          rel="noopener"
        >
          <Download className="size-3.5 mr-1.5" />
          Descargar PDF de factura original
        </a>
      </Button>
    </div>
  )
}
