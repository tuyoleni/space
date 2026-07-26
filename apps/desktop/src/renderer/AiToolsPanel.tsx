import { useCallback, useEffect, useState } from 'react';
import { Bot, Plug, PlugZap, Play, RefreshCw } from 'lucide-react';
import type { AiToolConnection, AiToolId, AiToolsStatus, TerminalSessionInfo } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardRows, CardTitle, StatusDot, useToast } from '@space/ui';
import { TerminalPanel } from './TerminalPanel';

interface AiToolsPanelProps {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
}

/**
 * "AI tools" card: the external AI coding tools on this machine and whether
 * they can see Space. Two actions, and the difference between them matters:
 *
 *  - **Connect** writes Space's local MCP server into that tool's own
 *    user-level config (starting the server if it was off), so the tool can
 *    ask Space which workspaces and projects exist and what their real Git
 *    state is — instead of working blind on whatever folder it was opened in.
 *  - **Launch here** starts the tool's own terminal agent *inside* the
 *    selected project's workspace-bound terminal, so every command it runs —
 *    installs, dev servers, scripts — inherits that workspace's environment
 *    rather than a raw shell.
 *
 * Only tools actually present on this machine get actions; a tool Space
 * can't configure for real says why instead of offering a button that
 * wouldn't work (same rule as the Connected Services card).
 */
export function AiToolsPanel({ workspaceId, projectId }: AiToolsPanelProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiToolsStatus | null>(null);
  const [busyToolId, setBusyToolId] = useState<AiToolId | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [agentSession, setAgentSession] = useState<TerminalSessionInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.space.aiTools.status());
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleServer(enabled: boolean): Promise<void> {
    setServerBusy(true);
    try {
      setStatus(await window.space.aiTools.setServerEnabled({ enabled }));
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setServerBusy(false);
    }
  }

  async function toggleConnection(tool: AiToolConnection): Promise<void> {
    setBusyToolId(tool.id);
    try {
      if (tool.connected) {
        await window.space.aiTools.disconnect({ tool: tool.id });
        toast({ variant: 'success', message: `${tool.displayName} disconnected from Space.` });
      } else {
        const result = await window.space.aiTools.connect({ tool: tool.id });
        toast({
          variant: 'success',
          message: `${tool.displayName} connected — ${result.created ? 'wrote' : 'updated'} ${result.configPath}. Restart ${tool.displayName} to pick it up.`,
        });
      }
      await refresh();
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusyToolId(null);
    }
  }

  async function launch(tool: AiToolConnection): Promise<void> {
    if (!workspaceId || !projectId) {
      return;
    }
    setBusyToolId(tool.id);
    try {
      const { sessionId } = await window.space.aiTools.launch({ tool: tool.id, workspaceId, projectId });
      setAgentSession({
        id: sessionId,
        workspaceId,
        projectId,
        shell: tool.displayName,
        cwd: '',
        pid: 0,
        state: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        lastOutputAt: null,
      });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusyToolId(null);
    }
  }

  const server = status?.server ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI tools</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          <RefreshCw size={12} />
        </Button>
      </CardHeader>

      <CardRows>
        <div className="flex items-center justify-between py-2">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm text-fg">
              <StatusDot tone={server?.enabled ? 'success' : 'neutral'} />
              Space MCP server
            </span>
            <span className="block truncate text-[11px] text-fg-faint">
              {server?.enabled ? `${server.url} · ${server.toolCount} tools` : 'Off — external tools can’t see this machine’s workspaces'}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={serverBusy}
            onClick={() => void toggleServer(!(server?.enabled ?? false))}
          >
            {server?.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>

        {(status?.tools ?? []).map((tool) => (
          <div key={tool.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm text-fg">
                <Bot size={13} className="text-fg-muted" />
                {tool.displayName}
                {tool.connected && <Badge variant="success">connected</Badge>}
              </span>
              <span className="block truncate text-[11px] text-fg-faint" title={tool.unavailableReason ?? tool.configPath}>
                {tool.unavailableReason ?? tool.configPath}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {tool.launchable && tool.connected && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyToolId !== null || !workspaceId || !projectId}
                  title={projectId ? `Start ${tool.displayName} in this project’s workspace terminal` : 'Select a project first'}
                  onClick={() => void launch(tool)}
                >
                  <Play size={12} /> Launch here
                </Button>
              )}
              {tool.detected && (
                <Button size="sm" variant="ghost" disabled={busyToolId !== null} onClick={() => void toggleConnection(tool)}>
                  {tool.connected ? <PlugZap size={12} /> : <Plug size={12} />} {tool.connected ? 'Disconnect' : 'Connect'}
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardRows>

      {agentSession && (
        <CardContent className="h-64 pt-0">
          <TerminalPanel session={agentSession} />
        </CardContent>
      )}
    </Card>
  );
}
