/**
 * Loading Skeleton: animated placeholder shapes shown while content loads.
 * Supports lines, circles, and rectangles with configurable dimensions.
 * Uses CSS animation for a subtle shimmer effect.
 */
import { cn } from '@space/ui';

interface SkeletonProps {
  readonly className?: string | undefined;
  readonly width?: string | number;
  readonly height?: string | number;
  readonly rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export function Skeleton({ className, width, height, rounded = 'md' }: SkeletonProps) {
  const roundedClass = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={cn('animate-pulse bg-skeleton', roundedClass, className)}
      style={{ width, height }}
    />
  );
}

export function SkeletonLine({ width = '100%', className }: { width?: string | number; className?: string }) {
  return <Skeleton width={width} height={12} className={className} />;
}

export function SkeletonCircle({ size = 24, className }: { size?: number; className?: string }) {
  return <Skeleton width={size} height={size} rounded="full" className={className} />;
}

/** Project card skeleton for loading states. */
export function ProjectCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <SkeletonCircle size={32} />
        <div className="flex-1 space-y-2">
          <SkeletonLine width="60%" />
          <SkeletonLine width="40%" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton width={60} height={20} rounded="full" />
        <Skeleton width={50} height={20} rounded="full" />
      </div>
    </div>
  );
}

/** Table row skeleton. */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 border-b border-border/30 px-3 py-2.5">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} width={i === 0 ? '40%' : `${Math.max(20, 80 - i * 15)}%`} height={12} />
      ))}
    </div>
  );
}

/** List item skeleton. */
export function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <SkeletonCircle size={20} />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width="70%" />
        <SkeletonLine width="30%" />
      </div>
    </div>
  );
}
