// src/app/(app)/admin/configuracion/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>

        {/* Tarjeta empresa */}
        <div className="rounded-lg border p-6 space-y-4">
          <Skeleton className="h-5 w-32" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>

        {/* Tarjeta secundaria */}
        <div className="rounded-lg border p-6 space-y-4">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        {/* Botón guardar */}
        <div className="flex justify-end">
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  )
}