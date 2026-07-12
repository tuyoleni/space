/**
 * TerminalClient owns the only channel the main process has into the
 * terminal worker — request correlation, timeouts, bounded crash-respawn,
 * and the subscribe() fan-out for streamed output. `electron.utilityProcess`
 * is mocked with a fake EventEmitter-based worker, same approach as
 * storage-client.test.ts.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalWorkerEvent, TerminalWorkerMessage } from '@space/terminal';

const fork = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ utilityProcess: { fork } }));

import { TerminalClient } from './terminal-client';

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

function reply(worker: FakeWorker, message: TerminalWorkerMessage): void {
  worker.emit('message', message);
}

function lastWorker(): FakeWorker {
  const worker = forkedWorkers.at(-1);
  if (!worker) {
    throw new Error('expected a worker to have been forked');
  }
  return worker;
}

describe('TerminalClient', () => {
  it('spawns a worker on start() and forwards call() as a postMessage', async () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    expect(fork).toHaveBeenCalledWith('/terminal-worker.js', [], { stdio: 'pipe' });

    const pending = client.call('terminal.list', { workspaceId: 'ws-1' });
    const worker = lastWorker();
    const sent = worker.postMessage.mock.calls[0]?.[0] as { id: string; method: string };
    expect(sent.method).toBe('terminal.list');

    reply(worker, { kind: 'response', id: sent.id, ok: true, result: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it('rejects call() with the worker-reported error on ok:false', async () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const pending = client.call('terminal.write', { sessionId: 'a', data: 'x' });
    const worker = lastWorker();
    const sent = worker.postMessage.mock.calls[0]?.[0] as { id: string };
    reply(worker, { kind: 'response', id: sent.id, ok: false, error: 'unknown session' });
    await expect(pending).rejects.toThrow('unknown session');
  });

  it('rejects call() if the worker never replies before the timeout', async () => {
    vi.useFakeTimers();
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const pending = client.call('terminal.list', { workspaceId: 'ws-1' });
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it('dispatches streamed events only to subscribers of the matching sessionId', () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const worker = lastWorker();

    const receivedA: TerminalWorkerEvent[] = [];
    const receivedB: TerminalWorkerEvent[] = [];
    client.subscribe('session-a', (event) => receivedA.push(event));
    client.subscribe('session-b', (event) => receivedB.push(event));

    reply(worker, { kind: 'event', type: 'output', sessionId: 'session-a', chunk: 'hi', sequence: 1, timestamp: 't' });
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it('unsubscribe stops further delivery', () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const worker = lastWorker();
    const received: TerminalWorkerEvent[] = [];
    const unsubscribe = client.subscribe('session-a', (event) => received.push(event));
    unsubscribe();
    reply(worker, { kind: 'event', type: 'output', sessionId: 'session-a', chunk: 'hi', sequence: 1, timestamp: 't' });
    expect(received).toHaveLength(0);
  });

  it('synthesizes an exit event for sessions that were live when the worker crashes', async () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const worker = lastWorker();

    const createPending = client.call('terminal.create', { workspaceId: 'ws-1', cols: 80, rows: 24 });
    const createSent = worker.postMessage.mock.calls[0]?.[0] as { id: string };
    reply(worker, {
      kind: 'response',
      id: createSent.id,
      ok: true,
      result: { id: 'session-a', workspaceId: 'ws-1', pid: 111, state: 'running' },
    });
    await createPending;

    const received: TerminalWorkerEvent[] = [];
    client.subscribe('session-a', (event) => received.push(event));

    worker.emit('exit', 1);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'exit', sessionId: 'session-a', exitCode: null });
  });

  it('respawns up to 3 times after a crash, then stops respawning', () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    expect(fork).toHaveBeenCalledTimes(1);
    for (let crash = 1; crash <= 3; crash += 1) {
      lastWorker().emit('exit', 1);
      expect(fork).toHaveBeenCalledTimes(crash + 1);
    }
    lastWorker().emit('exit', 1);
    expect(fork).toHaveBeenCalledTimes(4);
  });

  it('stop() kills the worker and further calls fail fast', async () => {
    const client = new TerminalClient('/terminal-worker.js');
    client.start();
    const worker = lastWorker();
    client.stop();
    expect(worker.kill).toHaveBeenCalledTimes(1);
    await expect(client.call('terminal.list', { workspaceId: 'ws-1' })).rejects.toThrow('not running');
  });
});
