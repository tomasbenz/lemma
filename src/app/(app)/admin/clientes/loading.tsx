import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-36" />
        </div>

        <Skeleton className="h-10 w-full max-w-md rounded-md" />

        <div className="rounded-lg border">
          <div className="p-3 border-b">
            <Skeleton className="h-6 w-full" />
          </div>
          <div className="divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-3">
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}