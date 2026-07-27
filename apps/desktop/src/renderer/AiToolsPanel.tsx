import { useCallback, useEffect, useState } from 'react';
import { Bot, Download, FolderCode, Plug, PlugZap, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AiToolConnection, AiToolId, AiToolsStatus, TerminalSessionInfo } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardRows, CardTitle, StatusDot, useToast } from '@space/ui';
import { TerminalPanel } from './TerminalPanel';
import { AI_TOOL_BRAND, BrandIcon } from './brand-icons';

interface AiToolsPanelProps {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
}

function AiToolIcon({ tool }: { readonly tool: AiToolConnection }) {
  if (tool.iconDataUrl) {
    return (
      <span className="flex size-[17px] shrink-0 items-center justify-center rounded-[4px] bg-white p-px shadow-sm">
        <img src={tool.iconDataUrl} alt="" className="size-[15px] rounded-[3px]" />
      </span>
    );
  }
  const brand = AI_TOOL_BRAND[tool.id];
  return (
    <span className="flex size-[17px] shrink-0 items-center justify-center rounded-[4px] bg-white p-px shadow-sm">
      {brand ? <BrandIcon icon={brand} size={14} /> : <Bot size={13} className="text-neutral-800" />}
    </span>
  );
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
 * Config-file tools can be connected before their first launch; launch
 * actions remain limited to tools whose executable Space can actually run.
 */
export function AiToolsPanel({ workspaceId, projectId }: AiToolsPanelProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiToolsStatus | null>(null);
  const [busyToolId, setBusyToolId] = useState<AiToolId | null>(null);
  const [connectAllBusy, setConnectAllBusy] = useState(false);
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

  async function connectAll(): Promise<void> {
    const pending = status?.tools.filter((tool) => tool.detected && !tool.connected) ?? [];
    if (pending.length === 0) {
      return;
    }
    setConnectAllBusy(true);
    const failed: string[] = [];
    for (const tool of pending) {
      try {
        // Keep these sequential: the first connection may start the shared
        // MCP server, and parallel callers must not race that lifecycle.
        // eslint-disable-next-line no-await-in-loop
        await window.space.aiTools.connect({ tool: tool.id });
      } catch {
        failed.push(tool.displayName);
      }
    }
    await refresh();
    setConnectAllBusy(false);
    if (failed.length > 0) {
      toast({ variant: 'error', message: `Could not connect: ${failed.join(', ')}.` });
    } else {
      toast({ variant: 'success', message: `Connected ${pending.length} developer tools to Space. Restart them to load the Space tools.` });
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

  async function openProject(tool: AiToolConnection): Promise<void> {
    if (!workspaceId || !projectId) return;
    setBusyToolId(tool.id);
    try {
      await window.space.aiTools.openProject({ tool: tool.id, workspaceId, projectId });
      toast({ variant: 'success', message: `Opened this project in ${tool.displayName}.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusyToolId(null);
    }
  }

  async function install(tool: AiToolConnection): Promise<void> {
    if (!tool.installPackage) return;
    setBusyToolId(tool.id);
    try {
      await window.space.packages.install(tool.installPackage);
      await refresh();
      toast({ variant: 'success', message: `${tool.displayName} installed. You can now open this project in it.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusyToolId(null);
    }
  }

  async function testConnection(tool: AiToolConnection): Promise<void> {
    if (!workspaceId || !projectId) return;
    setBusyToolId(tool.id);
    try {
      const result = await window.space.aiTools.testConnection({ tool: tool.id, workspaceId, projectId });
      await refresh();
      toast({ variant: 'success', message: `${tool.displayName} verified — ${result.workspaceName} / ${result.projectName}.` });
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusyToolId(null);
    }
  }

  const server = status?.server ?? null;

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-2">
        <div className="min-w-0">
          <CardTitle>Developer tools</CardTitle>
          <p className="mt-0.5 text-[11px] leading-4 text-fg-faint">
            Connect an assistant so it can ask Space for your real workspace and Git context.
          </p>
        </div>
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={connectAllBusy || busyToolId !== null || !status?.tools.some((tool) => tool.detected && !tool.connected)}
            onClick={() => void connectAll()}
          >
            <PlugZap size={12} /> {connectAllBusy ? 'Connecting…' : 'Connect all'}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Refresh AI tool connections" onClick={() => void refresh()}>
            <RefreshCw size={12} />
          </Button>
        </div>
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
          <div key={tool.id} className="flex flex-col gap-2 py-2.5">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg">
                <AiToolIcon tool={tool} />
                <span className="min-w-0 truncate">{tool.displayName}</span>
                {tool.verified ? <Badge variant="success">ready</Badge> : tool.connected ? <Badge variant="warning">configured</Badge> : null}
              </div>
              <span className="block truncate text-[11px] text-fg-faint" title={tool.unavailableReason ?? tool.configPath}>
                {tool.unavailableReason ?? `${tool.verificationMessage} · ${tool.configPath}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {tool.connected && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyToolId !== null || !workspaceId || !projectId}
                  title={projectId ? `Verify ${tool.displayName} and route this project through Space MCP` : 'Select a project first'}
                  onClick={() => void testConnection(tool)}
                >
                  <ShieldCheck size={12} /> Test
                </Button>
              )}
              {tool.openable && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyToolId !== null || !workspaceId || !projectId}
                  title={projectId ? `Open this project in ${tool.displayName}` : 'Select a project first'}
                  onClick={() => void openProject(tool)}
                >
                  <FolderCode size={12} /> Open project
                </Button>
              )}
              {!tool.openable && tool.installPackage && (
                <Button size="sm" variant="ghost" disabled={busyToolId !== null} onClick={() => void install(tool)}>
                  <Download size={12} /> Install
                </Button>
              )}
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
                <Button size="sm" variant="ghost" disabled={busyToolId !== null || connectAllBusy} onClick={() => void toggleConnection(tool)}>
                  {tool.connected ? <PlugZap size={12} /> : <Plug size={12} />} {tool.connected ? 'Disconnect' : 'Connect'}
                </Button>
              )}
            </div>
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
