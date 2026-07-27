import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StorageCaller } from '../project-handlers';
import type { TerminalCaller } from '../terminal-handlers';
import { createAiToolHandlers, type McpServerControls } from './ai-tool-handlers';

const temporaryDirectories: string[] = [];

async function makeHandlers() {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-ai-tools-test-'));
  temporaryDirectories.push(homeDirectory);
  let enabled = false;
  const server: McpServerControls = {
    isEnabled: () => enabled,
    url: () => (enabled ? 'http://127.0.0.1:4923/mcp' : null),
    setEnabled: async (next) => {
      enabled = next;
    },
    toolCount: 13,
    token: async () => 'test-token',
  };
  const storage = {
    call: async (method: string) => method === 'workspace.list' ? [] : undefined,
  } as unknown as StorageCaller;
  const terminal = { call: async () => undefined } as unknown as TerminalCaller;
  return {
    handlers: createAiToolHandlers(storage, {
      server,
      terminal,
      desktop: {
        describe: async () => null,
        openProject: async () => undefined,
        installPackage: () => ({ source: 'homebrew-cask', name: 'test-tool' }),
      },
      paths: { homeDirectory, appDataDirectory: path.join(homeDirectory, 'Library', 'Application Support') },
    }),
    configPath: path.join(homeDirectory, '.codex', 'config.toml'),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Codex AI tool connection', () => {
  it('is connectable without requiring a codex executable on PATH', async () => {
    const { handlers, configPath } = await makeHandlers();

    const status = await handlers.status();
    const codex = status.tools.find((tool) => tool.id === 'codex');

    expect(codex).toMatchObject({ detected: true, connected: false, configPath, unavailableReason: null });
    expect(status.tools.every((tool) => tool.detected)).toBe(true);
  });

  it('starts the server and writes a Codex MCP config that status can verify', async () => {
    const { handlers, configPath } = await makeHandlers();

    await expect(handlers.connect({ tool: 'codex' })).resolves.toMatchObject({ tool: 'codex', configPath, created: true });
    const contents = await fs.readFile(configPath, 'utf8');
    const status = await handlers.status();

    expect(contents).toContain('[mcp_servers.space]');
    expect(contents).toContain('Authorization = "Bearer test-token"');
    expect(status.server.enabled).toBe(true);
    expect(status.tools.find((tool) => tool.id === 'codex')?.connected).toBe(true);
  });

  it('connects Claude Code, Cursor, and VS Code through user config files without their CLIs', async () => {
    const { handlers } = await makeHandlers();

    await handlers.connect({ tool: 'claude-code' });
    await handlers.connect({ tool: 'cursor' });
    await handlers.connect({ tool: 'vscode' });
    const status = await handlers.status();

    expect(status.tools.filter((tool) => tool.id !== 'codex').every((tool) => tool.connected)).toBe(true);
  });

  it('does not report connected until that tool is set up in every Space project', async () => {
    const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-ai-connect-complete-'));
    temporaryDirectories.push(homeDirectory);
    const instructed: Array<{ projectPath: string; tool: string }> = [];
    const storage = {
      call: async (method: string, payload: { workspaceId?: string }) => {
        if (method === 'workspace.list') return [{ id: 'workspace-1', name: 'Test', active: true }];
        if (method === 'project.list' && payload.workspaceId === 'workspace-1') {
          return [
            { id: 'project-1', workspaceId: 'workspace-1', canonicalPath: '/projects/one' },
            { id: 'project-2', workspaceId: 'workspace-1', canonicalPath: '/projects/two' },
          ];
        }
        return undefined;
      },
    } as unknown as StorageCaller;
    let enabled = false;
    const handlers = createAiToolHandlers(storage, {
      server: {
        isEnabled: () => enabled,
        url: () => enabled ? 'http://127.0.0.1:4923/mcp' : null,
        setEnabled: async (next) => { enabled = next; },
        toolCount: 14,
        token: async () => 'test-token',
      },
      terminal: { call: async () => undefined } as unknown as TerminalCaller,
      desktop: { describe: async () => null, openProject: async () => undefined, installPackage: () => null },
      paths: { homeDirectory, appDataDirectory: path.join(homeDirectory, 'app-data') },
      projectInstructions: {
        ensure: async (projectPath, tool) => { instructed.push({ projectPath, tool }); },
        ensureAll: async () => undefined,
      },
    });

    await expect(handlers.connect({ tool: 'cursor' })).resolves.toMatchObject({ tool: 'cursor' });
    expect(instructed).toEqual([
      { projectPath: '/projects/one', tool: 'cursor' },
      { projectPath: '/projects/two', tool: 'cursor' },
    ]);
  });

  it('opens the registered project path in the selected desktop tool', async () => {
    const opened: Array<{ tool: string; projectPath: string }> = [];
    const storage = {
      call: async () => ({ workspaceId: 'workspace-1', canonicalPath: '/projects/actual-project' }),
    } as unknown as StorageCaller;
    const terminal = { call: async () => undefined } as unknown as TerminalCaller;
    const server: McpServerControls = {
      isEnabled: () => false,
      url: () => null,
      setEnabled: async () => undefined,
      toolCount: 14,
      token: async () => 'test-token',
    };
    const handlers = createAiToolHandlers(storage, {
      server,
      terminal,
      paths: { homeDirectory: '/tmp', appDataDirectory: '/tmp' },
      desktop: {
        describe: async () => ({ appPath: '/Applications/Cursor.app', iconDataUrl: 'data:image/png;base64,icon' }),
        installPackage: () => null,
        openProject: async (tool, projectPath) => { opened.push({ tool, projectPath }); },
      },
      projectInstructions: { ensure: async () => undefined, ensureAll: async () => undefined },
    });

    await expect(handlers.openProject({ tool: 'cursor', workspaceId: 'workspace-1', projectId: 'project-1' }))
      .resolves.toEqual({ opened: true });
    expect(opened).toEqual([{ tool: 'cursor', projectPath: '/projects/actual-project' }]);
  });

  it('tests a configured tool by calling get_project_context through the MCP endpoint', async () => {
    const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-ai-test-'));
    temporaryDirectories.push(homeDirectory);
    let enabled = false;
    const server: McpServerControls = {
      isEnabled: () => enabled,
      url: () => enabled ? 'http://127.0.0.1:4923/mcp' : null,
      setEnabled: async (next) => { enabled = next; },
      toolCount: 14,
      token: async () => 'test-token',
    };
    const storage = {
      call: async (method: string) => method === 'workspace.list'
        ? [{ id: 'workspace-1', name: 'Test', active: true }]
        : { id: 'project-1', name: 'space', workspaceId: 'workspace-1', canonicalPath: '/projects/space' },
    } as unknown as StorageCaller;
    const handlers = createAiToolHandlers(storage, {
      server,
      terminal: { call: async () => undefined } as unknown as TerminalCaller,
      paths: { homeDirectory, appDataDirectory: path.join(homeDirectory, 'app-data') },
      desktop: { describe: async () => null, installPackage: () => null, openProject: async () => undefined },
      projectInstructions: { ensure: async () => undefined, ensureAll: async () => undefined },
      fetchImpl: async () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ text: JSON.stringify({
            workspace: { id: 'workspace-1', name: 'Test' },
            project: { id: 'project-1', name: 'space', canonicalPath: '/projects/space' },
          }) }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    await handlers.connect({ tool: 'cursor' });

    await expect(handlers.testConnection({ tool: 'cursor', workspaceId: 'workspace-1', projectId: 'project-1' }))
      .resolves.toEqual({ tool: 'cursor', workspaceName: 'Test', projectName: 'space', projectPath: '/projects/space' });
  });
});
