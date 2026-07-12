import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { detectListeningUrl, startDetachedProcess, type ChildProcessLike, type ProcessSpawner } from './detached';

class FakeChild extends EventEmitter implements ChildProcessLike {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe('startDetachedProcess', () => {
  it('resolves immediately with a handle rather than waiting for exit', async () => {
    const child = new FakeChild();
    const spawner: ProcessSpawner = vi.fn(() => child);
    const handle = await startDetachedProcess(
      { operationId: 'op-1', workspaceId: 'ws-1', executableId: 'npm', args: ['run', 'dev'], env: {} },
      { resolveExecutable: async (id) => id, spawner },
    );
    expect(handle.pid).toBe(4242);
    expect(spawner).toHaveBeenCalledWith('npm', ['run', 'dev'], expect.objectContaining({ env: {} }));
  });

  it('forwards stdout/stderr chunks to onOutput listeners tagged by stream', async () => {
    const child = new FakeChild();
    const spawner: ProcessSpawner = () => child;
    const handle = await startDetachedProcess(
      { operationId: 'op-1', workspaceId: 'ws-1', executableId: 'npm', args: [], env: {} },
      { resolveExecutable: async (id) => id, spawner },
    );
    const received: Array<{ chunk: string; stream: string }> = [];
    handle.onOutput((chunk, stream) => received.push({ chunk, stream }));

    child.stdout.write('Local: http://localhost:5173\n');
    child.stderr.write('a warning\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toEqual(
      expect.arrayContaining([
        { chunk: 'Local: http://localhost:5173\n', stream: 'stdout' },
        { chunk: 'a warning\n', stream: 'stderr' },
      ]),
    );
  });

  it('notifies onExit listeners with the exit code', async () => {
    const child = new FakeChild();
    const spawner: ProcessSpawner = () => child;
    const handle = await startDetachedProcess(
      { operationId: 'op-1', workspaceId: 'ws-1', executableId: 'npm', args: [], env: {} },
      { resolveExecutable: async (id) => id, spawner },
    );
    const codes: Array<number | null> = [];
    handle.onExit((code) => codes.push(code));
    child.emit('exit', 0, null);
    expect(codes).toEqual([0]);
  });

  it('kill() forwards to the underlying child process', async () => {
    const child = new FakeChild();
    const spawner: ProcessSpawner = () => child;
    const handle = await startDetachedProcess(
      { operationId: 'op-1', workspaceId: 'ws-1', executableId: 'npm', args: [], env: {} },
      { resolveExecutable: async (id) => id, spawner },
    );
    handle.kill();
    expect(child.killed).toBe(true);
  });

  it('throws when the spawned process has no pid', async () => {
    const child = new FakeChild();
    // @ts-expect-error simulating a failed spawn
    child.pid = undefined;
    const spawner: ProcessSpawner = () => child;
    await expect(
      startDetachedProcess(
        { operationId: 'op-1', workspaceId: 'ws-1', executableId: 'npm', args: [], env: {} },
        { resolveExecutable: async (id) => id, spawner },
      ),
    ).rejects.toThrow(/no pid/);
  });
});

describe('detectListeningUrl', () => {
  it('finds a localhost URL embedded in noisy output', () => {
    expect(detectListeningUrl('  Local:   http://localhost:5173/\n')).toBe('http://localhost:5173/');
  });

  it('finds a 127.0.0.1 URL', () => {
    expect(detectListeningUrl('Server running at http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('returns null when no localhost URL is present', () => {
    expect(detectListeningUrl('Compiled successfully!')).toBeNull();
  });

  it('never matches a non-loopback host, even if it looks like a listening message', () => {
    expect(detectListeningUrl('Network: http://192.168.1.5:5173/')).toBeNull();
  });
});
