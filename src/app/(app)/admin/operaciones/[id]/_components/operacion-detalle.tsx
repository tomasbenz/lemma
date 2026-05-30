'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Operacion, ProductoResuelto } from '@/lib/queries/operaciones'
import {
  formatearAccion,
  renderParametros,
  fechaCorta,
} from '../../_lib/formato'

const TOPE_INICIAL = 50

export function OperacionDetalle({
  operacion,
  productos,
}: {
  operacion: Operacion
  productos: ProductoResuelto[]
}) {
  const [verTodos, setVerTodos] = useState(false)

  const porId = new Map(productos.map((p) => [p.id, p]))
  const ids = operacion.ids_afectados
  const visibles = verTodos ? ids : ids.slice(0, TOPE_INICIAL)
  const restantes = ids.length - visibles.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/admin/operaciones">
            <ArrowLeft className="size-4 mr-1" />
            Volver al listado
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          {formatearAccion(operacion.accion)}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-numeric font-medium text-foreground">
            {operacion.afectados}
          </span>{' '}
          afectados ·{' '}
          <span className="font-numeric font-medium text-foreground">
            {operacion.cantidad_omitidos}
          </span>{' '}
          omitidos · {fechaCorta(operacion.creado_at)} · por{' '}
          {operacion.usuario_email_snapshot}
        </p>
      </div>

      {/* Parámetros */}
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium mb-1">Parámetros aplicados</h2>
        <p className="text-sm text-muted-foreground">
          {renderParametros(operacion.accion, operacion.parametros)}
        </p>
      </section>

      {/* Afectados */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Productos afectados ({operacion.afectados})
        </h2>
        {ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No se modificó ningún producto.
          </p>
        ) : (
          <>
            <div className="rounded-lg border divide-y">
              {visibles.map((id) => {
                const p = porId.get(id)
                return (
                  <Link
                    key={id}
                    href={`/admin/productos/${id}`}
                    className="flex items-center gap-3 p-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <Package className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {p?.nombre ?? '(producto no encontrado)'}
                      </p>
                      {p?.sku_base && (
                        <p className="text-xs text-muted-foreground font-numeric truncate">
                          {p.sku_base}
                        </p>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
            {restantes > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVerTodos(true)}
              >
                Ver todos ({restantes} más)
              </Button>
            )}
          </>
        )}
      </section>

      {/* Omitidos */}
      {operacion.cantidad_omitidos > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle className="size-4 text-muted-foreground" />
            Productos omitidos ({operacion.cantidad_omitidos})
          </h2>
          <div className="rounded-lg border bg-muted/40 divide-y">
            {operacion.omitidos.map((o, i) => {
              const p = o.id ? porId.get(o.id) : undefined
              const etiqueta =
                p?.nombre ?? o.sku_variante ?? o.id ?? '(desconocido)'
              return (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-2.5"
                >
                  <div className="min-w-0">
                    {o.id ? (
                      <Link
                        href={`/admin/productos/${o.id}`}
                        className="text-sm truncate hover:underline"
                      >
                        {etiqueta}
                      </Link>
                    ) : (
                      <span className="text-sm truncate font-numeric">
                        {etiqueta}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {o.motivo}
                  </Badge>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
