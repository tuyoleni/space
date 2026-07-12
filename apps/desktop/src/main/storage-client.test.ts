/**
 * StorageClient owns the only channel the main process has into the
 * storage worker (ADR-003) — request correlation, timeouts, and bounded
 * crash-respawn. `electron.utilityProcess` is mocked with a fake
 * EventEmitter-based worker so this logic is verified without needing a
 * real Electron process.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageResponse } from './storage-protocol';

const fork = vi.hoisted(() => vi.fn());
// Vitest hoists vi.mock calls above every import in this file, so
// storage-client.ts's `import { utilityProcess } from 'electron'` resolves
// against this mock rather than the real (Electron-only) module.
vi.mock('electron', () => ({ utilityProcess: { fork } }));

import { StorageClient } from './storage-client';

class FakeWorker extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn();
}

let forkedWorkers: FakeWorker[];

beforeEach(() => {
  forkedWorkers = [];
  fork.mockReset();
  fork.mockImplementation(() => {
    const worker = new FakeWorker();
    forkedWorkers.push(worker);
    return worker;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function reply(worker: FakeWorker, response: StorageResponse): void {
  worker.emit('message', response);
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a defined value');
  }
  return value;
}

function lastWorker(): FakeWorker {
  return defined(forkedWorkers.at(-1));
}

describe('StorageClient', () => {
  it('spawns a worker on start() and forwards call() as a postMessage', async () => {
    const client = new StorageClient('/worker.js', '/db.sqlite');
    client.start();
    expect(fork).toHaveBeenCalledWith('/worker.js', ['/db.sqlite'], { stdio: 'pipe' });

    const pending = client.call('workspace.list', undefined);
    const worker = lastWorker();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const sent = defined(worker.postMessage.mock.calls[0])[0] as { id: string; method: string };
    expect(sent.method).toBe('workspace.list');

    reply(worker, { id: sent.id, ok: true, result: [{ id: 'ws-1' }] });
    await expect(pending).resolves.toEqual([{ id: 'ws-1' }]);
  });

  it('rejects call() with the worker-reported error on ok:false', async () => {
    const client = new StorageClient('/worker.js', '/db.sqlite');
    client.start();
    const pending = client.call('workspace.create', { name: 'A' });
    const worker = lastWorker();
    const sent = defined(worker.postMessage.mock.calls[0])[0] as { id: string };

    reply(worker, { id: sent.id, ok: false, error: 'disk full' });
    await expect(pending).rejects.toThrow('disk full');
  });

  it('rejects call() if the worker never replies before the timeout', async () => {
    vi.useFakeTimers();
    const client = new StorageClient('/worker.js', '/db.sqlite');
    client.start();
    const pending = client.call('workspace.list', undefined);
    // Swallow the eventual rejection so vitest doesn't flag it unhandled
    // before the assertion below attaches its own handler.
    pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it('rejects in-flight calls and respawns when the worker crashes, up to 3 times', async () => {
    const client = new StorageClient('/worker.js', '/db.sqlite');
    client.start();
    expect(fork).toHaveBeenCalledTimes(1);

    for (let crash = 1; crash <= 3; crash += 1) {
      const pending = client.call('workspace.list', undefined);
      lastWorker().emit('exit', 1);
      await expect(pending).rejects.toThrow(/exited/);
      expect(fork).toHaveBeenCalledTimes(crash + 1);
    }

    // A 4th crash exceeds MAX_RESPAWNS: no further respawn, and further
    // calls fail fast instead of hanging on a dead worker.
    lastWorker().emit('exit', 1);
    expect(fork).toHaveBeenCalledTimes(4);
    await expect(client.call('workspace.list', undefined)).rejects.toThrow(/not running/);
  });

  it('stop() kills the worker and further calls fail fast', async () => {
    const client = new StorageClient('/worker.js', '/db.sqlite');
    client.start();
    const worker = lastWorker();
    client.stop();
    expect(worker.kill).toHaveBeenCalledTimes(1);
    await expect(client.call('workspace.list', undefined)).rejects.toThrow(/not running/);
  });
});
