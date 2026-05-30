import { OperacionesSkeleton } from './_components/operaciones-skeleton'

export default function Loading() {
  return (
    <div className="flex-1 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-64 rounded bg-muted animate-pulse" />
          <div className="h-4 w-96 rounded bg-muted animate-pulse" />
        </div>
        <OperacionesSkeleton />
      </div>
    </div>
  )
}
