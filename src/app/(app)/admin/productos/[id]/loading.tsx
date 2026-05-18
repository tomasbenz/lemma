import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-32" />

        <div className="flex items-start gap-4">
          <Skeleton className="size-24 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>

        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  )
}