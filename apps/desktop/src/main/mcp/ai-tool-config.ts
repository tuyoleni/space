/**
 * The catalog of external AI coding tools Space knows how to wire to its own
 * local MCP server, and the real read/merge/remove work behind
 * "Connect" — so connecting is a button, not "open
 * <userData>/mcp/connection.json and paste this command somewhere".
 *
 * Two rules shape this file:
 *
 *  1. **Only tools whose config Space can write for real.** Every entry here
 *     is either driven by the tool's own CLI or uses a documented user-level
 *     config whose exact shape is encoded below. Config-file connections do
 *     not require the app or CLI to be running: Space can prepare the config
 *     now and the tool will load it on its next launch. A tool whose format
 *     Space would have to guess at is left out
 *     rather than half-supported — the same "never fabricate" rule the
 *     connected-services panel follows for un-deployable services.
 *  2. **User scope, not project scope.** Space's MCP tools are already
 *     workspace-wide (`list_workspaces`/`list_projects` span every
 *     workspace), so per-repository config would be both the wrong
 *     granularity and a way to drag the bearer token into a committed file.
 *     One connect per tool, valid from any directory, token stored in the
 *     tool's own config outside every repository.
 *
 * The merge/remove/probe helpers are deliberately pure over parsed JSON:
 * Space must never clobber a config a developer has already put their own
 * servers in, and that guarantee is worth testing directly.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AiToolConnectMechanism, AiToolId } from '@space/contracts';

/** The server name Space registers itself under in every tool's config. */
export const SPACE_MCP_SERVER_NAME = 'space';

/** The JSON key a tool nests its MCP servers under — VS Code uses `servers`, the others `mcpServers`. */
type McpConfigRootKey = 'mcpServers' | 'servers';

/** A block Space owns inside Codex's TOML config. It lets disconnect be lossless. */
const CODEX_BLOCK_START = '# BEGIN Space MCP (managed by Space)';
const CODEX_BLOCK_END = '# END Space MCP (managed by Space)';

export interface AiToolPaths {
  /** `os.homedir()`. */
  readonly homeDirectory: string;
  /** Electron's `app.getPath('appData')` — the per-platform roaming config root. */
  readonly appDataDirectory: string;
}

interface AiToolDefinition {
  readonly id: AiToolId;
  readonly displayName: string;
  readonly mechanism: AiToolConnectMechanism;
  /** Executable Space can start in a workspace-bound terminal, when the tool ships a terminal agent. */
  readonly launchExecutable: string | null;
  /** CLI-driven tools: the executable that owns the config. File-driven tools: null. */
  readonly cli: string | null;
  /** File-driven tools: where the user-level config lives, and the key its servers nest under. */
  readonly configFile: ((paths: AiToolPaths) => string) | null;
  readonly rootKey: McpConfigRootKey;
  /** The server entry Space writes; shape differs per tool. */
  readonly entry: (url: string, token: string) => Record<string, unknown>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    mechanism: 'config-file',
    launchExecutable: null,
    cli: null,
    configFile: (paths) => path.join(paths.homeDirectory, '.codex', 'config.toml'),
    // Codex uses TOML rather than this JSON format; its connection is handled
    // by the dedicated helpers below.
    rootKey: 'mcpServers',
    entry: () => ({}),
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    mechanism: 'config-file',
    launchExecutable: 'claude',
    cli: null,
    // This is the same user-scope config owned by `claude mcp add --scope
    // user`. Writing it directly keeps connection available when Claude Code
    // is bundled in a desktop app or otherwise absent from Electron's PATH.
    configFile: (paths) => path.join(paths.homeDirectory, '.claude.json'),
    rootKey: 'mcpServers',
    entry: (url, token) => ({ type: 'http', url, headers: authHeaders(token) }),
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    mechanism: 'config-file',
    launchExecutable: null,
    cli: null,
    configFile: (paths) => path.join(paths.homeDirectory, '.cursor', 'mcp.json'),
    rootKey: 'mcpServers',
    entry: (url, token) => ({ url, headers: authHeaders(token) }),
  },
  {
    id: 'vscode',
    displayName: 'VS Code',
    mechanism: 'config-file',
    launchExecutable: null,
    cli: null,
    // Electron's appData already resolves to the right root on each platform
    // (Application Support / %APPDATA% / .config), which is exactly where
    // VS Code keeps its user-level configuration.
    configFile: (paths) => path.join(paths.appDataDirectory, 'Code', 'User', 'mcp.json'),
    rootKey: 'servers',
    entry: (url, token) => ({ type: 'http', url, headers: authHeaders(token) }),
  },
];

export function findAiTool(id: AiToolId): AiToolDefinition {
  const found = AI_TOOLS.find((tool) => tool.id === id);
  if (!found) {
    throw new Error(`Unknown AI tool: ${id}`);
  }
  return found;
}

/** The config file for a file-driven tool; null for CLI-driven ones (their CLI owns it). */
export function aiToolConfigPath(tool: AiToolDefinition, paths: AiToolPaths): string | null {
  return tool.configFile ? tool.configFile(paths) : null;
}

function serversOf(config: unknown, rootKey: McpConfigRootKey): Record<string, unknown> {
  if (!config || typeof config !== 'object') {
    return {};
  }
  const nested = (config as Record<string, unknown>)[rootKey];
  return nested && typeof nested === 'object' ? { ...(nested as Record<string, unknown>) } : {};
}

/** True when Space's own server is already registered in this parsed config. */
export function hasSpaceServer(config: unknown, rootKey: McpConfigRootKey): boolean {
  return SPACE_MCP_SERVER_NAME in serversOf(config, rootKey);
}

/**
 * Space's entry merged into an existing config. Every other key in the file —
 * other MCP servers, unrelated top-level settings — is carried through
 * untouched; only `<rootKey>.space` is ours to write.
 */
export function mergeSpaceServer(
  config: unknown,
  rootKey: McpConfigRootKey,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
  return { ...base, [rootKey]: { ...serversOf(config, rootKey), [SPACE_MCP_SERVER_NAME]: entry } };
}

/** The config with only Space's entry removed — a disconnect must never take a developer's own servers with it. */
export function removeSpaceServer(config: unknown, rootKey: McpConfigRootKey): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
  const servers = serversOf(config, rootKey);
  delete servers[SPACE_MCP_SERVER_NAME];
  return { ...base, [rootKey]: servers };
}

/** Parsed config, or null when the file is missing or isn't valid JSON (both mean "nothing of ours is in there"). */
export async function readJsonConfig(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function writeJsonConfig(filePath: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function codexBlock(url: string, token: string): string {
  // JSON string escaping is also valid TOML basic-string escaping.
  return `${CODEX_BLOCK_START}\n[mcp_servers.${SPACE_MCP_SERVER_NAME}]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\n${CODEX_BLOCK_END}\n`;
}

function codexBlockPattern(): RegExp {
  return /\n?# BEGIN Space MCP \(managed by Space\)\r?\n[\s\S]*?# END Space MCP \(managed by Space\)\r?\n?/g;
}

/** True only for the entry Space itself has written; a user's Codex MCP server is never claimed as ours. */
export async function hasManagedCodexServer(filePath: string): Promise<boolean> {
  try {
    return (await fs.readFile(filePath, 'utf8')).includes(CODEX_BLOCK_START);
  } catch {
    return false;
  }
}

/**
 * Add Space's local HTTP MCP server to Codex's user config without parsing or
 * reserializing the rest of the user's TOML. A pre-existing `space` entry is
 * deliberately treated as a conflict rather than overwritten.
 */
export async function connectCodexServer(filePath: string, url: string, token: string): Promise<boolean> {
  let current = '';
  try {
    current = await fs.readFile(filePath, 'utf8');
  } catch {
    // The parent directory is created below for a first-time Codex setup.
  }
  if (current.includes(CODEX_BLOCK_START)) {
    return false;
  }
  if (/^\s*\[mcp_servers\.space\]\s*$/m.test(current)) {
    throw new Error("Codex already has an MCP server named 'space' that Space did not create. Rename or remove it in ~/.codex/config.toml before connecting from Space.");
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${current && !current.endsWith('\n') ? '\n' : ''}\n${codexBlock(url, token)}`, { encoding: 'utf8', mode: 0o600 });
  return true;
}

/** Remove only the exact marker-delimited block Space created. */
export async function disconnectCodexServer(filePath: string): Promise<void> {
  let current: string;
  try {
    current = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }
  const next = current.replace(codexBlockPattern(), '');
  if (next !== current) {
    await fs.writeFile(filePath, next, 'utf8');
  }
}

/** `claude mcp add` argv for the running server — a real CLI invocation, never a shell string. */
export function claudeMcpAddArgs(url: string, token: string): readonly string[] {
  return [
    'mcp',
    'add',
    '--transport',
    'http',
    '--scope',
    'user',
    '--header',
    `Authorization: Bearer ${token}`,
    SPACE_MCP_SERVER_NAME,
    url,
  ];
}

export function claudeMcpRemoveArgs(): readonly string[] {
  return ['mcp', 'remove', '--scope', 'user', SPACE_MCP_SERVER_NAME];
}

export function claudeMcpGetArgs(): readonly string[] {
  return ['mcp', 'get', SPACE_MCP_SERVER_NAME];
}
