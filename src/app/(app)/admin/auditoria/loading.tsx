// src/app/(app)/admin/auditoria/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
        </div>

        {/* Tabla */}
        <div className="rounded-lg border overflow-hidden">
          <div className="border-b p-3 flex gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="border-b last:border-b-0 p-3 flex gap-3 items-center"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-16 rounded-full ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}