/**
 * Real (non-fake) `PtySpawner` backed by `node-pty`, proven working inside
 * a real Electron `utilityProcess` by the P0-A spike
 * (apps/desktop/src/spikes/p0a-worker.ts). This is the only file in this
 * package that actually spawns a shell — `PtyHost`'s lifecycle,
 * backpressure, and binding logic all take `PtySpawner` as an injected
 * argument so they stay unit-testable without a real PTY.
 */
import * as pty from 'node-pty';
import type { PtyProcessHandle, PtySpawner } from './pty-host';

export function createNodePtySpawner(): PtySpawner {
  return (shell, args, options) => {
    const term = pty.spawn(shell, [...args], {
      name: 'xterm-color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env as Record<string, string>,
    });

    const handle: PtyProcessHandle = {
      pid: term.pid,
      onData: (listener) => {
        term.onData(listener);
      },
      onExit: (listener) => {
        term.onExit(({ exitCode, signal }) => listener({ exitCode, signal }));
      },
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      kill: (signal) => term.kill(signal),
    };
    return handle;
  };
}
