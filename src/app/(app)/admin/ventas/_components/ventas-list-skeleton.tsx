import { Skeleton } from '@/components/ui/skeleton'

export function VentasListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-md" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  )
}