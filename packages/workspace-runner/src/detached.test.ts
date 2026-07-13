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

  it('cannot find a URL split mid-scheme across two chunks when each chunk is checked in isolation', () => {
    // This documents exactly why a per-chunk-only caller misses real dev
    // server output: split squarely inside the "http" literal so *neither*
    // half contains a regex match on its own (not even a truncated one),
    // yet the concatenation does. Callers (project-handlers.ts's
    // startDevServer) must accumulate chunks into a buffer and match
    // against the whole thing instead.
    const firstHalf = '➜  Local:   ht';
    const secondHalf = 'tp://localhost:5173/\n';
    expect(detectListeningUrl(firstHalf)).toBeNull();
    expect(detectListeningUrl(secondHalf)).toBeNull();
    expect(detectListeningUrl(firstHalf + secondHalf)).toBe('http://localhost:5173/');
  });
});

describe('startDetachedProcess against a real Node process whose output is split across writes', () => {
  it('never delivers a matchable "Local:" line in a single onOutput chunk when the process writes it in two writes', async () => {
    // A real child process, not a mock: this proves the split genuinely
    // produces two separate stdout 'data' events at the OS/pipe level,
    // rather than asserting on a fabricated chunk boundary. The write is
    // split mid-scheme ("ht" / "tp://...") so neither individual chunk
    // contains anything detectListeningUrl can match.
    const script = `
      process.stdout.write('Local:   ht');
      setTimeout(() => {
        process.stdout.write('tp://localhost:5173/\\n');
        process.exit(0);
      }, 50);
    `;
    const handle = await startDetachedProcess(
      { operationId: 'op-split', workspaceId: 'ws-1', executableId: process.execPath, args: ['-e', script], env: { PATH: process.env['PATH'] ?? '' } },
      { resolveExecutable: async (id) => id },
    );

    const chunks: string[] = [];
    const exited = new Promise<void>((resolve) => handle.onExit(() => resolve()));
    handle.onOutput((chunk) => chunks.push(chunk));
    await exited;

    // Sanity: the write really did arrive as (at least) two separate
    // chunks — otherwise this test isn't exercising a real split.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each individual chunk must NOT contain a match — otherwise this
    // test isn't actually exercising the bug.
    for (const chunk of chunks) {
      expect(detectListeningUrl(chunk)).toBeNull();
    }
    // But the concatenation of everything received does contain it,
    // proving a buffer-accumulating caller would find it while a
    // per-chunk-only caller (the bug) never would.
    expect(detectListeningUrl(chunks.join(''))).toBe('http://localhost:5173/');
  }, 10000);
});
