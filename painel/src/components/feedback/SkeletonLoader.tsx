import { cn } from '@/lib/utils'

type SkeletonLoaderProps = { className?: string }

export function SkeletonLoader({ className }: SkeletonLoaderProps) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function SkeletonTabela({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonLoader className="h-4 w-8" />
          <SkeletonLoader className="h-4 flex-1" />
          <SkeletonLoader className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}
