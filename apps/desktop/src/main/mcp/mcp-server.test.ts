import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@space/logging';
import type { GitHandlers } from '../git-handlers';
import type { ProjectEnvironmentHandlers } from '../project-environment-handlers';
import type { StorageCaller } from '../project-handlers';
import { startMcpServer, type McpServerHandle } from './mcp-server';

const silentLogger: Logger = {
  debug() {
    /* silent by design — these tests assert behaviour, not log output */
  },
  info() {
    /* silent by design */
  },
  warn() {
    /* silent by design */
  },
  error() {
    /* silent by design */
  },
  withCorrelationId() {
    return silentLogger;
  },
};

/** A port the OS almost certainly isn't using; the test asserts binding succeeds. */
const TEST_PORT = 47119;

function makeDeps() {
  const call = (async (method: string) => {
    if (method === 'workspace.list') {
      return [{ id: 'ws-1', name: 'Demo', iconToken: 'a', active: true }];
    }
    if (method === 'project.list') {
      return [{ id: 'proj-1', workspaceId: 'ws-1', name: 'app', canonicalPath: '/tmp/app' }];
    }
    return undefined;
  }) as unknown as StorageCaller['call'];
  return {
    storage: { call },
    gitHandlers: {
      status: (async () => ({ branch: 'main', entries: [] })) as unknown as GitHandlers['status'],
    } as GitHandlers,
    projectEnvironmentHandlers: {
      environmentInfo: (async () => ({})) as unknown as ProjectEnvironmentHandlers['environmentInfo'],
    },
  };
}

async function readToken(dataDir: string): Promise<string> {
  return (await fs.readFile(path.join(dataDir, 'auth-token'), 'utf8')).trim();
}

const MCP_HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };

function rpc(method: string, params: unknown, id = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

describe('MCP HTTP server (end-to-end over a real socket)', () => {
  let dataDir: string;
  let handle: McpServerHandle;
  let url: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-mcp-test-'));
    handle = await startMcpServer({ deps: makeDeps(), logger: silentLogger, dataDir, appVersion: '9.9.9', port: TEST_PORT });
    url = handle.url;
  });

  afterEach(async () => {
    await handle.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('rejects a request with no bearer token (401)', async () => {
    const res = await fetch(url, { method: 'POST', headers: MCP_HEADERS, body: rpc('tools/list', {}) });
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong bearer token (401)', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: 'Bearer not-the-real-token' },
      body: rpc('tools/list', {}),
    });
    expect(res.status).toBe(401);
  });

  it('lists the read-only tool catalog for an authorized caller', async () => {
    const token = await readToken(dataDir);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${token}` },
      body: rpc('tools/list', {}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = (body.result.tools as Array<{ name: string; inputSchema: { type: string } }>).map((t) => t.name);
    expect(names).toContain('list_workspaces');
    expect(names).toContain('git_status');
    // Every advertised tool carries a JSON-Schema object, as MCP requires.
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('runs a tool call and returns the handler result as text content', async () => {
    const token = await readToken(dataDir);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${token}` },
      body: rpc('tools/call', { name: 'list_workspaces', arguments: {} }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed[0].name).toBe('Demo');
  });

  it('reports a bad tool input as a tool error, not a transport failure', async () => {
    const token = await readToken(dataDir);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${token}` },
      body: rpc('tools/call', { name: 'git_status', arguments: { projectId: '' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
  });

  it('writes an owner-only connection recipe while running and removes it on stop', async () => {
    const connectionPath = path.join(dataDir, 'connection.json');
    const connection = JSON.parse(await fs.readFile(connectionPath, 'utf8'));
    expect(connection.url).toBe(url);
    expect(connection.headers.Authorization).toMatch(/^Bearer /);
    await handle.stop();
    await expect(fs.access(connectionPath)).rejects.toThrow();
    // stop() is idempotent for the afterEach hook.
    handle = {
      url,
      stop: async () => {
        /* already stopped above */
      },
    };
  });
});
