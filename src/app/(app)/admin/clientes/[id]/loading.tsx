// src/app/(app)/admin/clientes/[id]/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back */}
        <Skeleton className="h-7 w-32" />

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 rounded-lg border p-6 space-y-4">
            <Skeleton className="h-5 w-24" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-3 items-start">
                <Skeleton className="size-4 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border p-6 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>

        {/* Listado ventas */}
        <div className="rounded-lg border p-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b last:border-b-0 py-2"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}