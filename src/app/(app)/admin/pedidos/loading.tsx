// src/app/(app)/admin/pedidos/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-10 w-48" />
        </div>

        {/* Listado */}
        <div className="rounded-lg border overflow-hidden">
          <div className="border-b p-3 flex gap-3 items-center">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32 ml-auto" />
          </div>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="border-b last:border-b-0 p-4 flex gap-3 items-center"
            >
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}