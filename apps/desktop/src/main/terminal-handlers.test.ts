/**
 * Regression coverage for the bug this file fixes: a plain "Open Terminal"
 * click threw `Cannot read properties of undefined (reading 'SHELL')`
 * because ipc.ts forwarded the renderer's bare `CreateTerminalInput`
 * straight to the terminal worker without ever building the `env`/`cwd`
 * `TerminalCreateRequest` requires (see packages/terminal/src/protocol.ts
 * and packages/terminal/src/pty-host.ts:127's `request.env['SHELL']`).
 * These tests prove createTerminal always produces a real environment and
 * a real cwd before calling the terminal worker, and that the produced
 * request is one `PtyHost.create` can actually consume without throwing.
 */
import { describe, expect, it, vi } from 'vitest';
import { PtyHost, type PtyProcessHandle, type PtySpawner } from '@space/terminal';
import { createTerminalHandlers, type TerminalCaller } from './terminal-handlers';

class FakePty implements PtyProcessHandle {
  pid = 1234;
  onData(_listener: (data: string) => void): void {
    // Not exercised by these tests — only shell resolution is under test.
  }
  onExit(_listener: (event: { readonly exitCode: number; readonly signal: number | undefined }) => void): void {
    // Not exercised by these tests — only shell resolution is under test.
  }
  write(_data: string): void {
    // Not exercised by these tests.
  }
  resize(_cols: number, _rows: number): void {
    // Not exercised by these tests.
  }
  kill(_signal?: string): void {
    // Not exercised by these tests.
  }
}

function fakeTerminalCaller(): TerminalCaller & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async call<T>(_method: string, payload: unknown): Promise<T> {
      calls.push(payload);
      return { id: 'term-1', ...(payload as object), pid: 999, startedAt: 't0' } as T;
    },
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('createTerminalHandlers', () => {
  it('builds a non-empty, sane env (including a resolvable PATH) for a minimal input with no project', async () => {
    const terminal = fakeTerminalCaller();
    const storage = { call: vi.fn() };
    const handlers = createTerminalHandlers(storage, { terminal, homeDirectory: '/Users/test' });

    await handlers.createTerminal({ workspaceId: 'ws-1', cols: 80, rows: 24 });

    expect(storage.call).not.toHaveBeenCalled();
    const request = terminal.calls[0] as { env: Record<string, string>; cwd: string; workspaceId: string; projectId: string | null };
    expect(request.env).toBeTruthy();
    expect(Object.keys(request.env).length).toBeGreaterThan(0);
    const pathValue = request.env['PATH'];
    expect(typeof pathValue).toBe('string');
    expect((pathValue ?? '').length).toBeGreaterThan(0);
    expect(request.cwd).toBe('/Users/test');
    expect(request.projectId).toBeNull();
  });

  it('resolves cwd from the bound project rather than the home-directory fallback', async () => {
    const terminal = fakeTerminalCaller();
    const storage = { call: vi.fn().mockResolvedValue({ canonicalPath: '/repos/my-project' }) };
    const handlers = createTerminalHandlers(storage, { terminal, homeDirectory: '/Users/test' });

    await handlers.createTerminal({ workspaceId: 'ws-1', projectId: 'proj-1', cols: 80, rows: 24 });

    expect(storage.call).toHaveBeenCalledWith('project.get', { projectId: 'proj-1' });
    const request = terminal.calls[0] as { cwd: string };
    expect(request.cwd).toBe('/repos/my-project');
  });

  it('produces a request that PtyHost.create can consume without throwing on shell resolution', async () => {
    const terminal = fakeTerminalCaller();
    const storage = { call: vi.fn() };
    const handlers = createTerminalHandlers(storage, { terminal, homeDirectory: '/Users/test' });

    await handlers.createTerminal({ workspaceId: 'ws-1', cols: 80, rows: 24 });
    const request = terminal.calls[0];

    const spawner: PtySpawner = vi.fn(() => new FakePty()) as unknown as PtySpawner;
    const host = new PtyHost({ spawner, emit: () => undefined });

    // This is exactly what threw before the fix: pty-host.ts reads
    // request.env['SHELL'], which crashed when env was undefined.
    expect(() => host.create(request as never, 'darwin')).not.toThrow();
    host.disposeAll();
  });
});
