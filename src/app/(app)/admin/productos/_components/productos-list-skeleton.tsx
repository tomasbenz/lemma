import { Skeleton } from '@/components/ui/skeleton'

export function ProductosListSkeleton() {
  return (
    <div className="space-y-4">
      {/* Barra de filtros skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-full sm:w-48" />
        <Skeleton className="h-10 w-full sm:w-32" />
      </div>

      {/* Tabla skeleton */}
      <div className="rounded-lg border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b p-4 last:border-0"
          >
            <Skeleton className="size-10 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-[40%]" />
              <Skeleton className="h-3 w-[25%]" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}