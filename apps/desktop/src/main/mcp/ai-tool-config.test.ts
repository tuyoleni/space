import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectCodexServer, disconnectCodexServer, hasManagedCodexServer } from './ai-tool-config';

const dirs: string[] = [];

async function temporaryCodexConfig(initial = ''): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-codex-config-test-'));
  dirs.push(dir);
  const configPath = path.join(dir, 'config.toml');
  await fs.writeFile(configPath, initial, 'utf8');
  return configPath;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Codex MCP config', () => {
  it('appends a marker-delimited HTTP MCP entry without touching existing config', async () => {
    const configPath = await temporaryCodexConfig('model = "gpt-5.6"\n');

    const created = await connectCodexServer(configPath, 'http://127.0.0.1:4923/mcp', 'secret-token');
    const contents = await fs.readFile(configPath, 'utf8');

    expect(created).toBe(true);
    expect(contents).toContain('model = "gpt-5.6"');
    expect(contents).toContain('[mcp_servers.space]');
    expect(contents).toContain('url = "http://127.0.0.1:4923/mcp"');
    expect(contents).toContain('http_headers = { Authorization = "Bearer secret-token" }');
    await expect(hasManagedCodexServer(configPath)).resolves.toBe(true);
  });

  it('is idempotent and removes only Space\'s own block', async () => {
    const configPath = await temporaryCodexConfig('[mcp_servers.other]\nurl = "https://example.test/mcp"\n');

    await connectCodexServer(configPath, 'http://127.0.0.1:4923/mcp', 'secret-token');
    await expect(connectCodexServer(configPath, 'http://127.0.0.1:4923/mcp', 'secret-token')).resolves.toBe(false);
    await disconnectCodexServer(configPath);
    const contents = await fs.readFile(configPath, 'utf8');

    expect(contents).toBe('[mcp_servers.other]\nurl = "https://example.test/mcp"\n');
    await expect(hasManagedCodexServer(configPath)).resolves.toBe(false);
  });

  it('refuses to overwrite a user-managed server named space', async () => {
    const configPath = await temporaryCodexConfig('[mcp_servers.space]\nurl = "https://user.example/mcp"\n');

    await expect(connectCodexServer(configPath, 'http://127.0.0.1:4923/mcp', 'secret-token')).rejects.toThrow(
      'did not create',
    );
  });
});
