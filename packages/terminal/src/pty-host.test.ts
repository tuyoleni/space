import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedactionRegistry } from '@space/workspace-runner';
import { PtyHost, defaultShellForPlatform, type PtyProcessHandle, type PtySpawner } from './pty-host';
import type { TerminalCreateRequest, TerminalWorkerEvent } from './protocol';

class FakePty implements PtyProcessHandle {
  pid = 4242;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((event: { exitCode: number; signal: number | undefined }) => void) | null = null;
  readonly written: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;

  onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }
  onExit(listener: (event: { exitCode: number; signal: number | undefined }) => void): void {
    this.exitListener = listener;
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
    this.exitListener?.({ exitCode: 0, signal: undefined });
  }
  emitData(data: string): void {
    this.dataListener?.(data);
  }
  emitExit(exitCode: number, signal?: number): void {
    this.exitListener?.({ exitCode, signal });
  }
}

function baseRequest(overrides: Partial<TerminalCreateRequest> = {}): TerminalCreateRequest {
  return {
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    cwd: '/tmp/project',
    env: { PATH: '/usr/bin' },
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

describe('defaultShellForPlatform', () => {
  it('uses powershell.exe on win32 regardless of $SHELL', () => {
    expect(defaultShellForPlatform('win32', '/bin/bash')).toBe('powershell.exe');
  });
  it('uses $SHELL on darwin/linux when set', () => {
    expect(defaultShellForPlatform('darwin', '/bin/bash')).toBe('/bin/bash');
  });
  it('falls back to /bin/zsh when $SHELL is unset', () => {
    expect(defaultShellForPlatform('darwin', undefined)).toBe('/bin/zsh');
  });
});

describe('PtyHost', () => {
  let events: TerminalWorkerEvent[];
  let lastPty: FakePty;
  let spawner: PtySpawner;
  let host: PtyHost;

  beforeEach(() => {
    events = [];
    spawner = vi.fn((_shell, _args, _options) => {
      lastPty = new FakePty();
      return lastPty;
    }) as unknown as PtySpawner;
    host = new PtyHost({ spawner, emit: (event) => events.push(event), flushIntervalMs: 5 });
  });

  afterEach(() => {
    host.disposeAll();
  });

  it('binds a session permanently to the workspace/project it was created with', () => {
    const session = host.create(baseRequest({ workspaceId: 'ws-a', projectId: 'proj-a' }));
    expect(session.workspaceId).toBe('ws-a');
    expect(session.projectId).toBe('proj-a');
    expect(session.state).toBe('running');
    expect(session.pid).toBe(4242);
  });

  it('resolves the default shell for the given platform when none is requested', () => {
    host.create(baseRequest(), 'darwin');
    expect(spawner).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({ cwd: '/tmp/project' }));
  });

  it('honours an explicit shell override', () => {
    host.create(baseRequest({ shell: '/bin/bash' }), 'darwin');
    expect(spawner).toHaveBeenCalledWith('/bin/bash', [], expect.anything());
  });

  it('passes explicit args through to the spawner (reused for GH-001\'s gh auth login, not just interactive shells)', () => {
    host.create(baseRequest({ shell: 'gh', args: ['auth', 'login', '--hostname', 'github.com'] }), 'darwin');
    expect(spawner).toHaveBeenCalledWith('gh', ['auth', 'login', '--hostname', 'github.com'], expect.anything());
  });

  it('flushes coalesced output as a single event per flush interval', async () => {
    const session = host.create(baseRequest());
    lastPty.emitData('hello ');
    lastPty.emitData('world');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const outputEvents = events.filter((e) => e.type === 'output' && e.sessionId === session.id);
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    const combined = outputEvents.map((e) => (e.type === 'output' ? e.chunk : '')).join('');
    expect(combined).toBe('hello world');
  });

  it('write() forwards to the pty and throws once the session has exited', () => {
    const session = host.create(baseRequest());
    host.write(session.id, 'ls\n');
    expect(lastPty.written).toEqual(['ls\n']);

    lastPty.emitExit(0);
    expect(() => host.write(session.id, 'ls\n')).toThrow(/already exited/);
  });

  it('resize() forwards cols/rows to the pty', () => {
    const session = host.create(baseRequest());
    host.resize(session.id, 120, 40);
    expect(lastPty.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('dispose() kills a running session and emits exit', () => {
    const session = host.create(baseRequest());
    host.dispose(session.id);
    expect(lastPty.killed).toBe(true);
    expect(events.some((e) => e.type === 'exit' && e.sessionId === session.id)).toBe(true);
  });

  it('marks the session state exited with an exit code on process exit', () => {
    const session = host.create(baseRequest());
    lastPty.emitExit(7);
    expect(host.get(session.id)?.state).toBe('exited');
    expect(host.get(session.id)?.exitCode).toBe(7);
    expect(host.get(session.id)?.endedAt).not.toBeNull();
  });

  it('list() reports every session, running and exited', () => {
    const a = host.create(baseRequest({ workspaceId: 'ws-a' }));
    const b = host.create(baseRequest({ workspaceId: 'ws-b' }));
    expect(host.list().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('redacts registered secrets from the retained diagnostic tail', async () => {
    const redaction = new RedactionRegistry();
    redaction.register('super-secret-token');
    const redactingHost = new PtyHost({ spawner, emit: (event) => events.push(event), flushIntervalMs: 5, redaction });
    const session = redactingHost.create(baseRequest());
    lastPty.emitData('token=super-secret-token done');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(redactingHost.recentOutputTail(session.id)).not.toContain('super-secret-token');
    expect(redactingHost.recentOutputTail(session.id)).toContain('[REDACTED]');
    // The live stream itself is not mutated — only the retained tail is (spec 15.5).
    const outputEvents = events.filter((e) => e.type === 'output');
    expect(outputEvents.some((e) => e.type === 'output' && e.chunk.includes('super-secret-token'))).toBe(true);
    redactingHost.disposeAll();
  });

  it('operations on an unknown session id throw rather than silently no-op', () => {
    expect(() => host.write('does-not-exist', 'x')).toThrow(/Unknown terminal session/);
    expect(() => host.resize('does-not-exist', 10, 10)).toThrow(/Unknown terminal session/);
    expect(() => host.dispose('does-not-exist')).toThrow(/Unknown terminal session/);
  });
});
