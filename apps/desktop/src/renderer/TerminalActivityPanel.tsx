import { Badge, Button, Card, StatusDot, Tabs, TabsContent, TabsList, TabsTrigger, formatRelativeTime } from '@space/ui';
import type { CommandHistoryEntry, ProblemEntry } from './useTerminalActivity';

interface TerminalActivityPanelProps {
  readonly problems: readonly ProblemEntry[];
  readonly suggestion: string | null;
  readonly history: readonly CommandHistoryEntry[];
  readonly cwd: string | null;
  readonly onRunSuggestion: (command: string) => void;
  // Jumps the terminal's own search to where this line actually occurred in
  // the real scrollback, rather than leaving Problems as a dead-end list.
  readonly onJumpToProblem: (text: string) => void;
}

const QUICK_ACTIONS = ['ls -la', 'cd ..', 'mkdir', 'touch'] as const;

export function TerminalActivityPanel({ problems, suggestion, history, cwd, onRunSuggestion, onJumpToProblem }: TerminalActivityPanelProps) {
  const errorCount = problems.filter((problem) => problem.severity === 'error').length;
  const displayCwd = cwd?.replace(/^\/Users\/[^/]+/, '~') ?? null;

  return (
    <Card className="flex items-stretch">
      <div className="min-w-0 flex-1">
        <Tabs defaultValue="output">
          <TabsList className="px-3.5">
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="problems">
              <span className="flex items-center gap-1.5">
                Problems
                {problems.length > 0 && <Badge variant={errorCount > 0 ? 'danger' : 'warning'}>{problems.length}</Badge>}
              </span>
            </TabsTrigger>
            <TabsTrigger value="hints">Command Hints</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="output">
            <p className="p-3.5 text-sm text-fg-faint">Live output is shown in the terminal above.</p>
          </TabsContent>

          <TabsContent value="problems" className="max-h-40 overflow-y-auto">
            {problems.length === 0 ? (
              <p className="p-3.5 text-sm text-fg-faint">No problems detected.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {problems.map((problem) => {
                  const timestamp = formatRelativeTime(problem.timestamp);
                  return (
                    <button
                      key={problem.id}
                      type="button"
                      onClick={() => onJumpToProblem(problem.text)}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-surface-hover"
                    >
                      <StatusDot tone={problem.severity === 'error' ? 'danger' : 'warning'} />
                      <span className="min-w-0 flex-1 truncate text-fg">{problem.text}</span>
                      <time className="shrink-0 text-xs text-fg-faint" dateTime={problem.timestamp} title={timestamp.exact}>
                        {timestamp.relative}
                      </time>
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="hints">
            {suggestion === null ? (
              <p className="p-3.5 text-sm text-fg-faint">No suggestion yet — run a command to get one.</p>
            ) : (
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg-muted">Try this next</span>
                  <span className="block truncate font-mono text-sm text-fg">{suggestion}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => onRunSuggestion(suggestion)}>
                  Run
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="max-h-40 overflow-y-auto">
            {history.length === 0 ? (
              <p className="p-3.5 text-sm text-fg-faint">No commands run yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {history.map((entry) => {
                  const timestamp = formatRelativeTime(entry.timestamp);
                  return (
                    <div key={entry.id} className="flex items-center gap-2.5 px-3.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{entry.command}</span>
                      <time className="shrink-0 text-xs text-fg-faint" dateTime={entry.timestamp} title={timestamp.exact}>
                        {timestamp.relative}
                      </time>
                      <Button size="sm" variant="ghost" onClick={() => onRunSuggestion(entry.command)}>
                        Run
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="w-52 shrink-0 border-l border-border p-3.5">
        <p className="text-xs font-medium text-fg-muted">Directory</p>
        <p className="mt-1 truncate text-xs text-fg-faint" title={cwd ?? undefined}>
          {displayCwd ?? 'No directory'}
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map((command) => (
            <Button key={command} size="sm" variant="secondary" className="font-mono" onClick={() => onRunSuggestion(command)}>
              {command}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
