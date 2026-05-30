export function OperacionesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-36 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-36 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="rounded-lg border divide-y">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/30 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
