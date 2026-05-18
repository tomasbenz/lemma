import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-56" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>

        <Skeleton className="h-32 w-full rounded-lg" />

        <div className="rounded-lg border">
          <div className="p-4 border-b">
            <Skeleton className="h-6 w-full" />
          </div>
          <div className="divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-3">
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}