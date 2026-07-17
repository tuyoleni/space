import { Loader2, TriangleAlert } from 'lucide-react';
import type { EnvironmentScanResult } from '@space/contracts';
import { Button, Card, CardHeader, CardRows, CardTitle, EmptyState } from '@space/ui';

interface EnvironmentSuggestedActionsProps {
  readonly scan: EnvironmentScanResult | null;
  readonly onInstallTool: (toolId: string) => void;
  readonly onUpdateTool: (toolId: string) => void;
  readonly busyToolIds: ReadonlySet<string>;
}

interface Suggestion {
  readonly key: string;
  readonly toolId: string;
  readonly message: string;
  readonly actionLabel: string;
  readonly onAction: (toolId: string) => void;
}

/**
 * "Suggested actions" card: derives its rows purely from the real scan
 * (not-installed tools, tools with an update available) — no fetching of
 * its own, so it can't drift from what the rest of the Environment screen
 * is showing.
 */
export function EnvironmentSuggestedActions({ scan, onInstallTool, onUpdateTool, busyToolIds }: EnvironmentSuggestedActionsProps) {
  const tools = scan?.tools ?? [];

  const suggestions: Suggestion[] = [
    ...tools
      .filter((tool) => !tool.found)
      .map((tool) => ({
        key: `install-${tool.toolId}`,
        toolId: tool.toolId,
        message: `${tool.displayName} is not installed`,
        actionLabel: 'Install',
        onAction: onInstallTool,
      })),
    ...tools
      .filter((tool) => tool.updateAvailable === true)
      .map((tool) => ({
        key: `update-${tool.toolId}`,
        toolId: tool.toolId,
        message: `${tool.displayName} ${tool.version ?? '?'} → ${tool.latestVersion ?? '?'} available`,
        actionLabel: 'Update',
        onAction: onUpdateTool,
      })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested actions</CardTitle>
      </CardHeader>
      {suggestions.length === 0 ? (
        <EmptyState title="Everything looks good." className="border-none" />
      ) : (
        <CardRows>
          {suggestions.map((suggestion) => {
            const busy = busyToolIds.has(suggestion.toolId);
            return (
              <div key={suggestion.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-fg">
                  <TriangleAlert size={14} className="shrink-0 text-warning" />
                  <span className="truncate">{suggestion.message}</span>
                </span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => suggestion.onAction(suggestion.toolId)}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                  {busy ? 'Working…' : suggestion.actionLabel}
                </Button>
              </div>
            );
          })}
        </CardRows>
      )}
    </Card>
  );
}
