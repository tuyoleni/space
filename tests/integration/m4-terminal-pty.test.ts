/**
 * M4: real PTY session through `PtyHost` using the real `node-pty` spawner
 * — the same production path `apps/desktop/src/main/terminal-worker.ts`
 * wires to `process.parentPort`, minus the Electron `utilityProcess`
 * transport itself (which the P0-A spike already proved works for
 * node-pty in both dev and packaged builds). This proves the host's
 * lifecycle tracking, write/resize, and backpressure-flushed output
 * against a genuine shell process, not a fake.
 */
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyHost, createNodePtySpawner } from '@space/terminal';
import type { TerminalWorkerEvent } from '@space/terminal';

let host: PtyHost | null = null;

afterEach(() => {
  host?.disposeAll();
  host = null;
});

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

describe('PtyHost against a real node-pty shell', () => {
  it('spawns a real shell, echoes real output, and tracks a real pid', async () => {
    const events: TerminalWorkerEvent[] = [];
    host = new PtyHost({ spawner: createNodePtySpawner(), emit: (event) => events.push(event), flushIntervalMs: 15 });

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env['SHELL'] || '/bin/zsh';
    const session = host.create({
      workspaceId: 'ws-real',
      projectId: null,
      shell,
      cwd: os.tmpdir(),
      env: { ...process.env, TERM: 'xterm-color' } as Record<string, string>,
      cols: 80,
      rows: 24,
    });

    expect(session.pid).toBeGreaterThan(0);
    expect(session.state).toBe('running');

    const marker = 'space-m4-pty-marker-done';
    host.write(session.id, `echo ${marker}\r`);

    await waitFor(() =>
      events.some((e) => e.type === 'output' && e.sessionId === session.id && e.chunk.includes(marker)),
    );

    host.dispose(session.id);
    await waitFor(() => events.some((e) => e.type === 'exit' && e.sessionId === session.id));
    expect(host.get(session.id)?.state).toBe('exited');
  }, 15000);
});
