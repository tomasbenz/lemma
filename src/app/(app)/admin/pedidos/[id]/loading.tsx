// src/app/(app)/admin/pedidos/[id]/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-7 w-32" />

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}