/**
 * Main-process business logic behind the Environment screen's "AI tools"
 * panel: detect the AI coding tools actually installed on this machine, wire
 * them to Space's local MCP server for real, and start them inside a
 * project's workspace-bound terminal.
 *
 * Why the launch half matters as much as the connect half: connecting only
 * lets a tool *observe* Space. A vibe-coding agent also shells out — installs
 * packages, starts services — and those commands have to land in the
 * workspace the project belongs to, not in whatever raw shell the tool
 * happened to inherit. `launch` closes that gap the same way every other
 * Space-spawned process does: a real PTY through the terminal worker, with an
 * environment from `buildSpaceEnvironment()` (spec 5.3 / TERM-003) and the
 * project's canonical path as cwd, plus `SPACE_*` context vars so the agent
 * can tell the MCP server which project it is standing in.
 *
 * `connect` starts the MCP server if it is off. That keeps the default-OFF
 * posture intact — the server still only runs after an explicit user action —
 * while making the one action a user takes ("connect Claude Code") actually
 * produce a working connection instead of a config pointing at a dead port.
 */
import { nodeRunCommand } from '@space/environment';
import path from 'node:path';
import type {
  AiToolConnectInput,
  AiToolConnectResult,
  AiToolConnection,
  AiToolLaunchInput,
  AiToolLaunchResult,
  AiToolOpenProjectInput,
  AiToolOpenProjectResult,
  AiToolTestConnectionInput,
  AiToolTestConnectionResult,
  AiToolsStatus,
  McpServerStatus,
  McpSetEnabledInput,
  Project,
  WorkspaceSummary,
} from '@space/contracts';
import { buildSpaceEnvironment } from '../environment-policy';
import type { StorageCaller } from '../project-handlers';
import type { TerminalCaller } from '../terminal-handlers';
import type { AiToolDesktopAdapter } from './ai-tool-desktop';
import { ensureAllProjectInstructions, ensureProjectInstruction } from './project-instructions';
import {
  AI_TOOLS,
  aiToolConfigPath,
  claudeMcpAddArgs,
  claudeMcpGetArgs,
  claudeMcpRemoveArgs,
  findAiTool,
  connectCodexServer,
  disconnectCodexServer,
  hasSpaceServer,
  hasManagedCodexServer,
  mergeSpaceServer,
  readJsonConfig,
  removeSpaceServer,
  writeJsonConfig,
  type AiToolPaths,
} from './ai-tool-config';

const CLI_TIMEOUT_MS = 10_000;

/** The MCP server's own start/stop surface, owned by main.ts (same one the Tools menu toggles). */
export interface McpServerControls {
  isEnabled(): boolean;
  /** The loopback URL while running, null while stopped. */
  url(): string | null;
  setEnabled(enabled: boolean): Promise<void>;
  readonly toolCount: number;
  /** The machine-local bearer token external tools must present. */
  token(): Promise<string>;
}

export interface AiToolHandlersOptions {
  readonly server: McpServerControls;
  readonly terminal: TerminalCaller;
  readonly paths: AiToolPaths;
  readonly desktop: AiToolDesktopAdapter;
  readonly fetchImpl?: typeof fetch;
  readonly projectInstructions?: {
    ensure(projectPath: string, tool: AiToolConnection['id']): Promise<unknown>;
    ensureAll(projectPath: string): Promise<unknown>;
  };
}

export interface AiToolHandlers {
  status(): Promise<AiToolsStatus>;
  setServerEnabled(input: McpSetEnabledInput): Promise<AiToolsStatus>;
  connect(input: AiToolConnectInput): Promise<AiToolConnectResult>;
  disconnect(input: AiToolConnectInput): Promise<void>;
  launch(input: AiToolLaunchInput): Promise<AiToolLaunchResult>;
  openProject(input: AiToolOpenProjectInput): Promise<AiToolOpenProjectResult>;
  testConnection(input: AiToolTestConnectionInput): Promise<AiToolTestConnectionResult>;
  syncProjectInstructions(project: Pick<Project, 'canonicalPath'>): Promise<void>;
  syncAllProjectInstructions(): Promise<void>;
}

/** A missing CLI (ENOENT) or a non-zero exit both mean "not usable here" — never thrown. */
async function cliSucceeds(executable: string, args: readonly string[]): Promise<boolean> {
  const result = await nodeRunCommand(executable, [...args], { timeoutMs: CLI_TIMEOUT_MS }).catch(() => null);
  return result !== null && result.exitCode === 0;
}

async function runCliOrThrow(executable: string, args: readonly string[], action: string): Promise<void> {
  const result = await nodeRunCommand(executable, [...args], { timeoutMs: CLI_TIMEOUT_MS }).catch((error: unknown) => {
    throw new Error(`${action} failed: ${executable} could not be run (${error instanceof Error ? error.message : String(error)})`);
  });
  if (result.exitCode !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new Error(`${action} failed: ${executable} exited ${result.exitCode}${output ? ` — ${output}` : ''}`);
  }
}

export function createAiToolHandlers(storage: StorageCaller, options: AiToolHandlersOptions): AiToolHandlers {
  const { server, paths } = options;
  const projectInstructions = options.projectInstructions ?? {
    ensure: ensureProjectInstruction,
    ensureAll: ensureAllProjectInstructions,
  };

  function serverStatus(): McpServerStatus {
    return { enabled: server.isEnabled(), url: server.url(), toolCount: server.toolCount };
  }

  async function describeTool(id: AiToolConnection['id']): Promise<AiToolConnection> {
    const tool = findAiTool(id);
    const configPath = aiToolConfigPath(tool, paths);
    const desktop = await options.desktop.describe(id);
    const desktopFields = {
      openable: desktop !== null,
      iconDataUrl: desktop?.iconDataUrl ?? null,
      installPackage: desktop ? null : options.desktop.installPackage(id),
    };
    const verification = async (configured: boolean): Promise<Pick<AiToolConnection, 'verified' | 'verificationMessage'>> => {
      if (!configured) return { verified: false, verificationMessage: 'Not configured' };
      if (!server.isEnabled()) return { verified: false, verificationMessage: 'Configured · Space server is off' };
      if (id === 'claude-code') {
        const executable = path.join(paths.homeDirectory, '.local', 'bin', 'claude');
        const result = await nodeRunCommand(executable, ['mcp', 'get', 'space'], { timeoutMs: CLI_TIMEOUT_MS }).catch(() => null);
        const verified = result?.exitCode === 0 && `${result.stdout}${result.stderr}`.includes('Connected');
        return verified
          ? { verified: true, verificationMessage: 'Verified by Claude Code' }
          : { verified: false, verificationMessage: 'Configured · restart Claude Code or check MCP health' };
      }
      return { verified: true, verificationMessage: 'Configuration and Space server ready' };
    };

    if (tool.cli) {
      const detected = await cliSucceeds(tool.cli, ['--version']);
      return {
        id: tool.id,
        displayName: tool.displayName,
        detected,
        mechanism: tool.mechanism,
        configPath: `${tool.cli} mcp add … --scope user`,
        connected: detected ? await cliSucceeds(tool.cli, claudeMcpGetArgs()) : false,
        ...(await verification(detected ? await cliSucceeds(tool.cli, claudeMcpGetArgs()) : false)),
        launchable: detected && tool.launchExecutable !== null,
        ...desktopFields,
        unavailableReason: detected ? null : `${tool.cli} isn't on this machine's PATH.`,
      };
    }

    if (!configPath) {
      return {
        id: tool.id,
        displayName: tool.displayName,
        detected: false,
        mechanism: tool.mechanism,
        configPath: '',
        connected: false,
        ...(await verification(false)),
        launchable: false,
        ...desktopFields,
        unavailableReason: `Space has no known config location for ${tool.displayName} on this platform.`,
      };
    }

    if (tool.id === 'codex') {
      const connected = await hasManagedCodexServer(configPath);
      return {
        id: tool.id,
        displayName: tool.displayName,
        // Codex Desktop reads ~/.codex/config.toml directly. Requiring a
        // separately discoverable `codex` executable here hid Connect on the
        // standard macOS install, whose bundled CLI is not on Electron's PATH.
        // Space can create this config itself, so connecting is always
        // available even when no terminal CLI is installed.
        detected: true,
        mechanism: tool.mechanism,
        configPath,
        connected,
        ...(await verification(connected)),
        launchable: false,
        ...desktopFields,
        unavailableReason: null,
      };
    }

    const config = await readJsonConfig(configPath);
    const connected = hasSpaceServer(config, tool.rootKey);
    const launchable = tool.launchExecutable
      ? await cliSucceeds(tool.launchExecutable, ['--version'])
      : false;
    return {
      id: tool.id,
      displayName: tool.displayName,
      // A file-configured tool is connectable even before first launch:
      // writeJsonConfig creates its parent directory and the tool picks the
      // config up when it starts. Detection is therefore a capability flag,
      // not an installation probe.
      detected: true,
      mechanism: tool.mechanism,
      configPath,
      connected,
      ...(await verification(connected)),
      launchable,
      ...desktopFields,
      unavailableReason: null,
    };
  }

  async function status(): Promise<AiToolsStatus> {
    const tools = await Promise.all(AI_TOOLS.map((tool) => describeTool(tool.id)));
    return { server: serverStatus(), tools };
  }

  async function setServerEnabled(input: McpSetEnabledInput): Promise<AiToolsStatus> {
    await server.setEnabled(input.enabled);
    return status();
  }

  async function connect(input: AiToolConnectInput): Promise<AiToolConnectResult> {
    const tool = findAiTool(input.tool);

    // A config that points at a stopped server is not a connection, so the
    // connect action owns starting it.
    if (!server.isEnabled()) {
      await server.setEnabled(true);
    }
    const url = server.url();
    if (!url) {
      throw new Error("Space's local MCP server isn't running, so there's no address to connect to.");
    }
    const token = await server.token();
    // Complete the project-side setup before writing the global connection.
    // If a repository is not writable, the action fails while the tool still
    // correctly appears disconnected instead of leaving a partial setup that
    // the UI could mistake for ready.
    await syncToolProjectInstructions(tool.id);
    let result: AiToolConnectResult;

    if (tool.cli) {
      // Re-adding an existing entry is an error in some CLIs; remove ours
      // first so connect stays idempotent. A failure here is fine — it just
      // means there was nothing of ours to remove.
      await cliSucceeds(tool.cli, claudeMcpRemoveArgs());
      await runCliOrThrow(tool.cli, claudeMcpAddArgs(url, token), `Connecting ${tool.displayName}`);
      result = { tool: tool.id, configPath: `${tool.cli} mcp add … --scope user`, created: true };
    } else {
      const configPath = aiToolConfigPath(tool, paths);
      if (!configPath) {
        throw new Error(`Space has no known config location for ${tool.displayName} on this platform.`);
      }
      if (tool.id === 'codex') {
        const created = await connectCodexServer(configPath, url, token);
        result = { tool: tool.id, configPath, created };
      } else {
        const existing = await readJsonConfig(configPath);
        await writeJsonConfig(configPath, mergeSpaceServer(existing, tool.rootKey, tool.entry(url, token)));
        result = { tool: tool.id, configPath, created: existing === null };
      }
    }

    return result;
  }

  async function disconnect(input: AiToolConnectInput): Promise<void> {
    const tool = findAiTool(input.tool);
    if (tool.cli) {
      await runCliOrThrow(tool.cli, claudeMcpRemoveArgs(), `Disconnecting ${tool.displayName}`);
      return;
    }
    const configPath = aiToolConfigPath(tool, paths);
    if (!configPath) {
      return;
    }
    if (tool.id === 'codex') {
      await disconnectCodexServer(configPath);
      return;
    }
    const existing = await readJsonConfig(configPath);
    if (!hasSpaceServer(existing, tool.rootKey)) {
      return;
    }
    await writeJsonConfig(configPath, removeSpaceServer(existing, tool.rootKey));
  }

  async function launch(input: AiToolLaunchInput): Promise<AiToolLaunchResult> {
    const tool = findAiTool(input.tool);
    if (!tool.launchExecutable) {
      throw new Error(`${tool.displayName} has no terminal agent Space can start.`);
    }
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    if (project.workspaceId !== input.workspaceId) {
      throw new Error('That project belongs to a different workspace.');
    }
    await projectInstructions.ensure(project.canonicalPath, input.tool);

    const session = await options.terminal.call<{ id: string }>('terminal.create', {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      shell: tool.launchExecutable,
      args: [],
      cwd: project.canonicalPath,
      // The whole point of launching from Space: the agent — and everything
      // it shells out to — inherits this workspace's environment, plus enough
      // context to ask the MCP server which project it is working in. The
      // bearer token is deliberately not here; the tool already has it in its
      // own config, and the environment of a process an agent controls is the
      // wrong place for a credential (spec 25.1).
      env: buildSpaceEnvironment({
        operationVars: {
          SPACE_WORKSPACE_ID: input.workspaceId,
          SPACE_PROJECT_ID: input.projectId,
          SPACE_PROJECT_PATH: project.canonicalPath,
          ...(server.url() ? { SPACE_MCP_URL: server.url() as string } : {}),
        },
      }),
      cols: 120,
      rows: 30,
    });
    return { sessionId: session.id };
  }

  async function openProject(input: AiToolOpenProjectInput): Promise<AiToolOpenProjectResult> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    if (project.workspaceId !== input.workspaceId) {
      throw new Error('That project belongs to a different workspace.');
    }
    await projectInstructions.ensure(project.canonicalPath, input.tool);
    await options.desktop.openProject(input.tool, project.canonicalPath);
    return { opened: true };
  }

  async function testConnection(input: AiToolTestConnectionInput): Promise<AiToolTestConnectionResult> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    if (project.workspaceId !== input.workspaceId) throw new Error('That project belongs to a different workspace.');
    await projectInstructions.ensure(project.canonicalPath, input.tool);

    const configured = await describeTool(input.tool);
    if (!configured.connected) throw new Error(`${configured.displayName} is not configured for Space yet.`);
    if (!server.isEnabled()) await server.setEnabled(true);
    const url = server.url();
    if (!url) throw new Error("Space's MCP server did not start.");

    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await server.token()}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_project_context', arguments: { path: project.canonicalPath } },
      }),
    });
    if (!response.ok) throw new Error(`Space MCP health check failed with HTTP ${response.status}.`);
    const rpc = await response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
      error?: { message?: string };
    };
    const text = rpc.result?.content?.[0]?.text;
    if (rpc.error || rpc.result?.isError || !text) throw new Error(rpc.error?.message ?? text ?? 'Space MCP returned no project context.');
    const context = JSON.parse(text) as {
      workspace?: { id?: string; name?: string };
      project?: { id?: string; name?: string; canonicalPath?: string };
    };
    if (context.workspace?.id !== input.workspaceId || context.project?.id !== input.projectId) {
      throw new Error('Space MCP returned a different project than the one selected.');
    }
    const workspaces = await storage.call<WorkspaceSummary[]>('workspace.list', {});
    const workspaceName = context.workspace.name ?? workspaces.find((workspace) => workspace.id === input.workspaceId)?.name;
    return {
      tool: input.tool,
      workspaceName: workspaceName ?? input.workspaceId,
      projectName: context.project.name ?? project.name,
      projectPath: context.project.canonicalPath ?? project.canonicalPath,
    };
  }

  async function syncProjectInstructions(project: Pick<Project, 'canonicalPath'>): Promise<void> {
    await projectInstructions.ensureAll(project.canonicalPath);
  }

  async function listAllProjects(): Promise<Project[]> {
    const workspaces = await storage.call<WorkspaceSummary[]>('workspace.list', {});
    return (await Promise.all(workspaces.map((workspace) =>
      storage.call<Project[]>('project.list', { workspaceId: workspace.id }))))
      .flat();
  }

  async function syncToolProjectInstructions(tool: AiToolConnection['id']): Promise<void> {
    const projects = await listAllProjects();
    await Promise.all(projects.map((project) => projectInstructions.ensure(project.canonicalPath, tool)));
  }

  async function syncAllProjectInstructions(): Promise<void> {
    const projects = await listAllProjects();
    await Promise.all(projects.map(syncProjectInstructions));
  }

  return {
    status,
    setServerEnabled,
    connect,
    disconnect,
    launch,
    openProject,
    testConnection,
    syncProjectInstructions,
    syncAllProjectInstructions,
  };
}
