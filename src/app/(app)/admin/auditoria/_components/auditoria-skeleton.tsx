import { Skeleton } from '@/components/ui/skeleton'

export function AuditoriaSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="rounded-lg border">
        <div className="p-3 border-b">
          <Skeleton className="h-6 w-full" />
        </div>
        <div className="divide-y">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="p-3">
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}