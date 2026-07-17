import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { EnvironmentScanResult, Project, SystemProcessInfo, SystemStatsResult, TerminalSessionInfo, WorkspaceSummary } from '@space/contracts';
import { Button, Card, EmptyState, Select } from '@space/ui';
import { TerminalPanel, type TerminalPanelHandle } from '../TerminalPanel';
import { TerminalSidebar } from '../TerminalSidebar';
import { TerminalActivityPanel } from '../TerminalActivityPanel';
import { suggestionFor, useTerminalActivity } from '../useTerminalActivity';

const STATS_POLL_MS = 3_000;
const CD_PATTERN = /^cd(?:\s+(.+))?$/;

/** Best-effort, deterministic `cd` resolution from a real typed/sent command — never a guess beyond what the argument itself says. */
function applyCd(current: string, arg: string | undefined): string {
  const target = arg?.trim();
  if (!target || target === '~' || target === '.' || target === '-') {
    return current;
  }
  if (target.startsWith('/')) {
    return target;
  }
  if (target === '..') {
    const parts = current.split('/').filter(Boolean);
    parts.pop();
    return `/${parts.join('/')}`;
  }
  return `${current.replace(/\/+$/, '')}/${target}`;
}

interface TerminalsViewProps {
  readonly workspace: WorkspaceSummary;
  readonly projects: readonly Project[];
  readonly envScan: EnvironmentScanResult | null;
  readonly selectedProjectId: string | null;
}

export function TerminalsView({ workspace, projects, envScan, selectedProjectId }: TerminalsViewProps) {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newTerminalProjectId, setNewTerminalProjectId] = useState<string>(selectedProjectId ?? 'none');
  // Keeps the new-terminal project picker following whichever project is
  // currently open, so a new terminal is bound to it without the user
  // re-picking it every time — until they explicitly choose something else
  // themselves, at which point their choice sticks instead of being
  // silently overwritten by the next project switch.
  const projectIdTouchedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<SystemStatsResult | null>(null);
  const [processes, setProcesses] = useState<readonly SystemProcessInfo[]>([]);
  // Real session.cwd is frozen at creation time; this tracks the directory
  // forward from there using only `cd` commands we've actually seen run (typed
  // or sent via a quick action) — so "Working Dir" stays live instead of
  // silently going stale the moment someone cd's around.
  const [liveCwd, setLiveCwd] = useState<Record<string, string>>({});
  // One handle per *open* session, not one shared ref — each session gets
  // its own permanently-mounted TerminalPanel (see the render below), so
  // switching tabs never tears down and recreates anyone's xterm instance.
  const terminalHandles = useRef(new Map<string, TerminalPanelHandle>());
  const autoCreateAttemptedRef = useRef(false);
  const activity = useTerminalActivity();

  const refresh = useCallback(async () => {
    const list = await window.space.terminal.list(workspace.id);
    const running = list.filter((session) => session.state === 'running');
    setSessions(running);
    // A blank "No terminals open" screen isn't what anyone wants from a
    // terminal page — provision a real one immediately instead of waiting
    // for a manual click, but only ever attempt this once per mount so a
    // deliberately-closed-down-to-zero state doesn't keep refilling itself.
    if (running.length === 0 && !autoCreateAttemptedRef.current) {
      autoCreateAttemptedRef.current = true;
      await createTerminal();
    }
  }, [workspace.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0]?.id ?? null);
    }
  }, [sessions, activeSessionId]);

  useEffect(() => {
    if (!projectIdTouchedRef.current) {
      setNewTerminalProjectId(selectedProjectId ?? 'none');
    }
  }, [selectedProjectId]);

  // Live resource sampling while this screen is visible — same pattern as HomeView.
  useEffect(() => {
    let cancelled = false;
    async function sample(): Promise<void> {
      const [nextStats, nextProcesses] = await Promise.all([window.space.system.stats(), window.space.system.processes()]);
      if (cancelled) {
        return;
      }
      setStats(nextStats);
      setProcesses(nextProcesses);
    }
    void sample();
    const timer = setInterval(() => void sample(), STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function createTerminal(): Promise<void> {
    setBusy(true);
    try {
      const session = await window.space.terminal.create({
        workspaceId: workspace.id,
        ...(newTerminalProjectId !== 'none' ? { projectId: newTerminalProjectId } : {}),
        cols: 100,
        rows: 28,
      });
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);
    } finally {
      setBusy(false);
    }
  }

  async function closeTerminal(session: TerminalSessionInfo): Promise<void> {
    setBusy(true);
    try {
      await window.space.terminal.dispose({ sessionId: session.id });
      setSessions((prev) => prev.filter((candidate) => candidate.id !== session.id));
      setActiveSessionId((current) => (current === session.id ? null : current));
      setLiveCwd((prev) => {
        if (!(session.id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function getActiveHandle(): TerminalPanelHandle | undefined {
    return activeSessionId ? terminalHandles.current.get(activeSessionId) : undefined;
  }

  const active = sessions.find((session) => session.id === activeSessionId) ?? null;
  const sessionHistory = active ? activity.history.filter((entry) => entry.sessionId === active.id) : [];
  const sessionProblems = active ? activity.problems.filter((entry) => entry.sessionId === active.id) : [];
  // Scoped to the active tab's own last command — a suggestion is only
  // useful if it's actually about what just ran in *this* terminal.
  const sessionSuggestion = suggestionFor(sessionHistory[0]?.command ?? '');
  const activeCwd = active ? liveCwd[active.id] ?? active.cwd : null;

  // One shared recording path for a command, regardless of whether it was
  // really typed or sent by a quick action/history/hint button — both are
  // real commands hitting the real PTY, and both should show up in
  // History/Problems/suggestions and move the tracked cwd forward the same way.
  function recordExecuted(sessionId: string, command: string, timestamp: string, fallbackCwd: string): void {
    activity.recordCommand(sessionId, command, timestamp);
    const cdMatch = CD_PATTERN.exec(command.trim());
    if (cdMatch) {
      setLiveCwd((prev) => ({ ...prev, [sessionId]: applyCd(prev[sessionId] ?? fallbackCwd, cdMatch[1]) }));
    }
  }

  function runCommand(command: string): void {
    if (!active) {
      return;
    }
    const handle = getActiveHandle();
    handle?.sendLine(command);
    recordExecuted(active.id, command, new Date().toISOString(), active.cwd);
    // A Quick Action/history/hint click is standing in for a keystroke — the
    // user should land back in the terminal ready to keep typing, not stuck
    // with focus on the button they just clicked.
    handle?.focus();
  }

  function handleFind(): void {
    const term = window.prompt('Find in terminal:');
    if (term) {
      getActiveHandle()?.find(term);
    }
  }

  function handleExport(): void {
    const text = getActiveHandle()?.exportBuffer();
    if (!text) {
      return;
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `terminal-session-${active?.id ?? 'export'}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <Card className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {sessions.map((session) => {
                const project = projects.find((candidate) => candidate.id === session.projectId);
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setActiveSessionId(session.id)}
                    className={
                      'flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                      (session.id === activeSessionId
                        ? 'border-border bg-surface-hover text-fg'
                        : 'border-transparent text-fg-muted hover:bg-surface-hover')
                    }
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    {project?.name ?? session.shell}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Close terminal ${project?.name ?? session.shell}`}
                      className="rounded p-0.5 hover:bg-surface-hover"
                      onClick={(event) => {
                        event.stopPropagation();
                        void closeTerminal(session);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                          void closeTerminal(session);
                        }
                      }}
                    >
                      <X size={12} />
                    </span>
                  </button>
                );
              })}
            </div>
            <Select
              ariaLabel="New terminal project"
              value={newTerminalProjectId}
              onValueChange={(value) => {
                projectIdTouchedRef.current = true;
                setNewTerminalProjectId(value);
              }}
              options={[{ value: 'none', label: 'No project' }, ...projects.map((project) => ({ value: project.id, label: project.name }))]}
              className="w-40"
            />
            <Button size="sm" onClick={() => void createTerminal()} disabled={busy}>
              <Plus size={13} /> New terminal
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {/* Every open session stays mounted permanently — only display
                toggles on tab switch — so its xterm buffer and PTY
                subscription survive moving between tabs, the same way the
                whole view survives moving between pages. */}
            {sessions.map((session) => (
              <div key={session.id} className={session.id === activeSessionId ? 'h-full' : 'hidden'}>
                <TerminalPanel
                  ref={(handle) => {
                    if (handle) {
                      terminalHandles.current.set(session.id, handle);
                    } else {
                      terminalHandles.current.delete(session.id);
                    }
                  }}
                  session={session}
                  onCommand={(command, timestamp) => recordExecuted(session.id, command, timestamp, session.cwd)}
                  onOutputChunk={(chunk, timestamp) => activity.recordOutput(session.id, chunk, timestamp)}
                />
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="p-6">
                <EmptyState
                  title="No terminals open"
                  description="Start a real, workspace-bound terminal session."
                  action={
                    <Button size="sm" onClick={() => void createTerminal()} disabled={busy}>
                      <Plus size={13} /> New terminal
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        </Card>

        {active && (
          <TerminalActivityPanel
            problems={sessionProblems}
            suggestion={sessionSuggestion}
            history={sessionHistory}
            cwd={activeCwd}
            onRunSuggestion={runCommand}
            onJumpToProblem={(text) => getActiveHandle()?.find(text)}
          />
        )}
      </div>
      <TerminalSidebar
        session={active ? { ...active, cwd: activeCwd ?? active.cwd } : null}
        envScan={envScan}
        stats={stats}
        processes={processes}
        onNewTerminal={() => void createTerminal()}
        onClear={() => getActiveHandle()?.clear()}
        onFind={handleFind}
        onExport={handleExport}
      />
    </div>
  );
}
