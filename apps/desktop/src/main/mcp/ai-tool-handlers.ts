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
import path from 'node:path';
import { nodeRunCommand } from '@space/environment';
import type {
  AiToolConnectInput,
  AiToolConnectResult,
  AiToolConnection,
  AiToolLaunchInput,
  AiToolLaunchResult,
  AiToolsStatus,
  McpServerStatus,
  McpSetEnabledInput,
  Project,
} from '@space/contracts';
import { buildSpaceEnvironment } from '../environment-policy';
import type { StorageCaller } from '../project-handlers';
import type { TerminalCaller } from '../terminal-handlers';
import {
  AI_TOOLS,
  aiToolConfigPath,
  claudeMcpAddArgs,
  claudeMcpGetArgs,
  claudeMcpRemoveArgs,
  findAiTool,
  hasSpaceServer,
  mergeSpaceServer,
  pathExists,
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
}

export interface AiToolHandlers {
  status(): Promise<AiToolsStatus>;
  setServerEnabled(input: McpSetEnabledInput): Promise<AiToolsStatus>;
  connect(input: AiToolConnectInput): Promise<AiToolConnectResult>;
  disconnect(input: AiToolConnectInput): Promise<void>;
  launch(input: AiToolLaunchInput): Promise<AiToolLaunchResult>;
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

  function serverStatus(): McpServerStatus {
    return { enabled: server.isEnabled(), url: server.url(), toolCount: server.toolCount };
  }

  async function describeTool(id: AiToolConnection['id']): Promise<AiToolConnection> {
    const tool = findAiTool(id);
    const configPath = aiToolConfigPath(tool, paths);

    if (tool.cli) {
      const detected = await cliSucceeds(tool.cli, ['--version']);
      return {
        id: tool.id,
        displayName: tool.displayName,
        detected,
        mechanism: tool.mechanism,
        configPath: `${tool.cli} mcp add … --scope user`,
        connected: detected ? await cliSucceeds(tool.cli, claudeMcpGetArgs()) : false,
        launchable: detected && tool.launchExecutable !== null,
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
        launchable: false,
        unavailableReason: `Space has no known config location for ${tool.displayName} on this platform.`,
      };
    }

    // "Installed" for a file-driven tool means its user config directory
    // exists — the app itself may live anywhere, and Space never guesses at
    // install paths.
    const detected = await pathExists(path.dirname(configPath));
    const config = await readJsonConfig(configPath);
    return {
      id: tool.id,
      displayName: tool.displayName,
      detected,
      mechanism: tool.mechanism,
      configPath,
      connected: hasSpaceServer(config, tool.rootKey),
      launchable: false,
      unavailableReason: detected ? null : `${tool.displayName} hasn't been run on this machine yet.`,
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

    if (tool.cli) {
      // Re-adding an existing entry is an error in some CLIs; remove ours
      // first so connect stays idempotent. A failure here is fine — it just
      // means there was nothing of ours to remove.
      await cliSucceeds(tool.cli, claudeMcpRemoveArgs());
      await runCliOrThrow(tool.cli, claudeMcpAddArgs(url, token), `Connecting ${tool.displayName}`);
      return { tool: tool.id, configPath: `${tool.cli} mcp add … --scope user`, created: true };
    }

    const configPath = aiToolConfigPath(tool, paths);
    if (!configPath) {
      throw new Error(`Space has no known config location for ${tool.displayName} on this platform.`);
    }
    const existing = await readJsonConfig(configPath);
    await writeJsonConfig(configPath, mergeSpaceServer(existing, tool.rootKey, tool.entry(url, token)));
    return { tool: tool.id, configPath, created: existing === null };
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

  return { status, setServerEnabled, connect, disconnect, launch };
}
