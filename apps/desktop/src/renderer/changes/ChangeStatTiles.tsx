import type { ReactNode } from 'react';
import { Card, CardContent, cn } from '@space/ui';

export type StatTileTone = 'default' | 'success' | 'danger' | 'warning' | 'accent';

export interface ChangeStatTile {
  readonly label: string;
  readonly value: string | number;
  readonly sub?: ReactNode;
  readonly tone?: StatTileTone;
  readonly icon?: ReactNode;
}

export interface ChangeStatTilesProps {
  readonly tiles: readonly ChangeStatTile[];
}

const TONE_TEXT: Record<StatTileTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent',
};

const TONE_ICON: Record<StatTileTone, string> = {
  default: 'bg-surface-hover text-fg-muted',
  success: 'bg-success/12 text-success',
  danger: 'bg-danger/12 text-danger',
  warning: 'bg-warning/12 text-warning',
  accent: 'bg-accent/12 text-accent',
};

/**
 * The demo's row of five stat cards: a muted label top-left, a subtle
 * tinted icon chip top-right, a large value, and a metadata sub-line. Tone
 * colors both the value and the icon chip so a zero-conflict card reads calm
 * and a hot one reads loud.
 */
export function ChangeStatTiles({ tiles }: ChangeStatTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const tone = tile.tone ?? 'default';
        return (
          <Card key={tile.label}>
            <CardContent className="py-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-fg-muted">{tile.label}</p>
                {tile.icon && (
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', TONE_ICON[tone])}>{tile.icon}</span>
                )}
              </div>
              <p className={cn('mt-2 text-2xl font-semibold leading-none', TONE_TEXT[tone])}>{tile.value}</p>
              {tile.sub && <p className="mt-1.5 text-[11px] text-fg-faint">{tile.sub}</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
