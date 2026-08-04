/**
 * Breadcrumb navigation: shows the current location in the app hierarchy
 * with clickable segments. Supports truncation for deep paths.
 */
import { ChevronRight } from 'lucide-react';
import { cn } from '@space/ui';

export interface BreadcrumbSegment {
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly onClick?: () => void;
}

interface BreadcrumbProps {
  readonly segments: readonly BreadcrumbSegment[];
  readonly className?: string;
  readonly maxVisible?: number;
}

export function Breadcrumb({ segments, className, maxVisible = 4 }: BreadcrumbProps) {
  if (segments.length === 0) return null;

  const first = segments[0];
  if (!first) return null;

  const visibleSegments: BreadcrumbSegment[] = segments.length > maxVisible
    ? [first, { label: '...' }, ...segments.slice(-Math.max(1, maxVisible - 2))]
    : [...segments];

  return (
    <nav className={cn('flex items-center gap-0.5 text-xs', className)}>
      {visibleSegments.map((segment, i) => {
        const isDots = segment.label === '...';
        return (
          <div key={i} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight size={10} className="text-fg-faint" />}
            {segment.onClick ? (
              <button
                type="button"
                onClick={segment.onClick}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                {segment.icon}
                {segment.label}
              </button>
            ) : (
              <span className={cn(
                'flex items-center gap-1 px-1 py-0.5',
                isDots ? 'text-fg-faint' : 'text-fg',
              )}>
                {segment.icon}
                {segment.label}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
