import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-32" />

        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-48 md:col-span-2 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>

        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  )
}