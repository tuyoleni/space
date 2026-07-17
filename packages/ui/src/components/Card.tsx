import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/**
 * A dashboard card. Every card shares one structure: a `CardHeader` (title
 * row with a divider beneath), a body, and an optional `CardFooter` (action
 * row with a divider above). Rows live inside `CardRows`, whose dividers —
 * and the header/footer borders — all run the full card width, edge to
 * edge, because the horizontal padding is applied to each row (`[&>*]:px-4`)
 * rather than to the divider container. No nested boxes: the whole surface
 * reads as one flat, lined panel.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-fg', className)} {...props} />;
}

/** Free-form body (grids, single blocks). Use `CardRows` for lined lists. */
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-3.5 py-2.5', className)} {...props} />;
}

/**
 * A lined list of rows. Dividers span the full width; each direct child is
 * padded to `px-3.5` so its content still aligns with the header/footer.
 */
export function CardRows({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col divide-y divide-border [&>*]:px-3.5', className)} {...props} />;
}

/** Action row pinned to the card's bottom, separated by a full-width rule. */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center border-t border-border px-3.5 py-2', className)} {...props} />;
}
