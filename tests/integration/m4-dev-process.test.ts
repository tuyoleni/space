/**
 * M4: real detached dev-server-shaped process (PRJ-006) — a genuine Node
 * child process binds an HTTP server to an ephemeral port (`0`, never a
 * fixed real port, per the milestone's testing rules), prints a
 * "Local: http://localhost:<port>" line the way Vite/Next do, and this
 * test detects that URL from real stdout and then stops the process for
 * real. Always torn down in afterEach so nothing lingers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectListeningUrl, startDetachedProcess, type DetachedProcessHandle } from '@space/workspace-runner';

let dir: string;
let handle: DetachedProcessHandle | null = null;

afterEach(() => {
  handle?.kill();
  handle = null;
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const DEV_SERVER_SCRIPT = `
const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
server.listen(0, '127.0.0.1', () => {
  console.log('Local: http://localhost:' + server.address().port + '/');
});
process.on('SIGTERM', () => process.exit(0));
`;

describe('startDetachedProcess against a real Node dev-server-shaped process', () => {
  it('spawns for real, detects the listening URL from real stdout, and stops the process', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m4-devproc-'));
    const scriptPath = path.join(dir, 'server.js');
    fs.writeFileSync(scriptPath, DEV_SERVER_SCRIPT);

    handle = await startDetachedProcess(
      { operationId: 'op-dev-1', workspaceId: 'ws-1', executableId: 'node', args: [scriptPath], env: { PATH: process.env['PATH'] ?? '' } },
      { resolveExecutable: async (id) => id },
    );
    expect(handle.pid).toBeGreaterThan(0);

    const detectedUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for listening URL')), 5000);
      handle?.onOutput((chunk) => {
        const url = detectListeningUrl(chunk);
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      });
    });

    expect(detectedUrl).toMatch(/^http:\/\/localhost:\d+\/$/);
    // Never a fixed real port — the OS assigned an ephemeral one.
    const port = Number(new URL(detectedUrl).port);
    expect(port).toBeGreaterThan(0);

    const exited = new Promise<number | null>((resolve) => handle?.onExit(resolve));
    handle.kill('SIGTERM');
    const exitCode = await exited;
    expect(exitCode).toBe(0);
  }, 10000);
});
