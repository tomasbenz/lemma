import { Skeleton } from '@/components/ui/skeleton'

export function ClientesListSkeleton() {
  return (
    <div className="space-y-4">
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
  )
}