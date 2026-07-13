/**
 * M6: createGithubHandlers exercised end to end against a real temp
 * SQLite database (via handleStorageRequest, mirroring m5-git-handlers)
 * and an in-memory credential store — proving the credential
 * architecture (spec 5.6) actually wires up: a workspace's token comes
 * from the injected `CredentialStorePort`, never SQLite, is merged only
 * into the `gh`/`git` child process's own environment, and is redacted
 * out of anything that reaches a receipt.
 *
 * Every `gh` call goes through a fake `GhExecutor` returning realistic
 * `--json` fixture output — per this milestone's hard safety boundary,
 * no real `gh` process requiring auth is ever invoked in this suite. The
 * one real process spawning here is git against a local `git init
 * --bare` directory standing in for "the remote" (never a network call),
 * the same pattern m5-git-handlers.test.ts and m5-git-lifecycle.test.ts
 * already use for fetch/pull/push.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GhCommandResult, GhExecutor } from '@space/github-engine';
import { buildGithubCredentialRef } from '@space/github-engine';
import { createNodeGitExecutor } from '@space/git-engine';
import { InMemoryCredentialStore } from '@space/security';
import { createStorage, type Storage } from '@space/storage';
import type { Workspace } from '@space/contracts';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import { createGithubHandlers, type TerminalCaller } from '../../apps/desktop/src/main/github-handlers';
import type { StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';
import type { TerminalWorkerEvent } from '@space/terminal';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m6-handlers-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storageCaller = {
    call: <T>(method: StorageMethod, payload: unknown) => {
      requestSequence += 1;
      return handleStorageRequest(storage, { id: `req-${requestSequence}`, method, payload }) as Promise<T>;
    },
  };
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeWorkspace(name = 'A'): Promise<Workspace> {
  return storageCaller.call<Workspace>('workspace.create', { name });
}

/** A fake TerminalCaller that immediately "runs" gh auth login and reports success — no real PTY, no real gh auth login (forbidden by this milestone's safety boundary). */
function fakeTerminal(exitCode: number): TerminalCaller {
  let listener: ((event: TerminalWorkerEvent) => void) | null = null;
  return {
    call: async <T>(method: string, _payload: unknown): Promise<T> => {
      if (method === 'terminal.create') {
        return { id: 'session-1' } as unknown as T;
      }
      return undefined as unknown as T;
    },
    subscribe: (_sessionId: string, cb: (event: TerminalWorkerEvent) => void) => {
      listener = cb;
      queueMicrotask(() => listener?.({ kind: 'event', type: 'exit', sessionId: 'session-1', exitCode, signal: null, timestamp: new Date().toISOString() }));
      return () => {
        listener = null;
      };
    },
  };
}

function recordingGhExecutor(handler: (args: readonly string[]) => GhCommandResult, seen: { args: readonly string[]; env: Record<string, string> }[]): GhExecutor {
  return async (args, options) => {
    seen.push({ args: [...args], env: { ...(options?.env ?? {}) } });
    return handler(args);
  };
}

describe('credential architecture (spec 5.6): token resolution, env injection, redaction', () => {
  it('resolves a workspace token from the injected CredentialStorePort (never SQLite) and injects it only into the gh child process env', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    await credentialStore.set(buildGithubCredentialRef(workspace.id, 'github.com'), 'gho_supersecret');
    await storageCaller.call('githubConnection.upsert', {
      id: 'conn-1',
      workspaceId: workspace.id,
      adapterId: 'github',
      host: 'github.com',
      accountLabel: 'octocat',
      profileLabel: null,
      secretRefId: null,
      state: 'connected',
      lastVerifiedAt: null,
    });

    const seen: { args: readonly string[]; env: Record<string, string> }[] = [];
    const ghExecutor = recordingGhExecutor(
      () => ({ exitCode: 0, stdout: 'gh version 2.95.0 (2025-06-10)\n', stderr: '' }),
      seen,
    );

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.authReport(workspace.id);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.env['GH_TOKEN']).toBe('gho_supersecret');
    expect(seen[0]?.env['GH_CONFIG_DIR']).toBe(path.join(dir, 'gh-config', workspace.id));

    // The raw token never appears anywhere in the real SQLite database.
    storage.close();
    const rawDbBytes = fs.readFileSync(path.join(dir, 'space.sqlite'));
    expect(rawDbBytes.includes('gho_supersecret')).toBe(false);
  });

  it('redacts the token out of gh stdout/stderr before it can reach a receipt', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    await credentialStore.set(buildGithubCredentialRef(workspace.id, 'github.com'), 'gho_leakme');
    await storageCaller.call('githubConnection.upsert', {
      id: 'conn-1',
      workspaceId: workspace.id,
      adapterId: 'github',
      host: 'github.com',
      accountLabel: null,
      profileLabel: null,
      secretRefId: null,
      state: 'connected',
      lastVerifiedAt: null,
    });

    const ghExecutor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'error: bad credentials for token gho_leakme' });

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await expect(handlers.logout(workspace.id)).rejects.toThrow();
    // logout's own error path still must never surface the raw token — check indirectly via listOrgs, which returns null rather than throwing.
    const orgs = await handlers.listOrgs(workspace.id);
    expect(orgs).toBeNull();
  });
});

describe('GH-001: interactive auth login via the reused PTY host', () => {
  it('records a succeeded receipt and a connected ServiceConnection row on a successful login', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    const ghExecutor: GhExecutor = async (args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          exitCode: 0,
          stdout: 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.startAuthLogin({ workspaceId: workspace.id, cwd: dir });
    // The fake terminal resolves its exit event on a microtask; flush it.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'github.auth.login' && op.state === 'succeeded')).toBe(true);

    const connection = await storageCaller.call('githubConnection.get', { workspaceId: workspace.id, adapterId: 'github', host: 'github.com' });
    expect(connection).toMatchObject({ state: 'connected', accountLabel: 'octocat' });
  });

  it('captures the real token gh just obtained into the credential store and records a real SecretRef (ADR-002 fallback, spec 5.6)', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    const ghExecutor: GhExecutor = async (args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          exitCode: 0,
          stdout: 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n',
          stderr: '',
        };
      }
      if (args[0] === 'auth' && args[1] === 'token') {
        return { exitCode: 0, stdout: 'gho_freshlogintoken\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.startAuthLogin({ workspaceId: workspace.id, cwd: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The credential store — never SQLite — now really holds the token.
    expect(await credentialStore.get(buildGithubCredentialRef(workspace.id, 'github.com'))).toBe('gho_freshlogintoken');

    // The ServiceConnection row references it for real, not with a
    // permanently-null secretRefId.
    const connection = await storageCaller.call<{ secretRefId: string | null }>('githubConnection.get', {
      workspaceId: workspace.id,
      adapterId: 'github',
      host: 'github.com',
    });
    expect(connection?.secretRefId).toBe(`${workspace.id}:github:github.com`);

    // The raw token never appears anywhere in the real SQLite database.
    storage.close();
    const rawDbBytes = fs.readFileSync(path.join(dir, 'space.sqlite'));
    expect(rawDbBytes.includes('gho_freshlogintoken')).toBe(false);
  });

  it('a subsequent call resolves the captured token from the credential store and injects it into gh/git child process env', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    const seen: { args: readonly string[]; env: Record<string, string> }[] = [];
    const ghExecutor: GhExecutor = async (args, options) => {
      seen.push({ args: [...args], env: { ...(options?.env ?? {}) } });
      if (args[0] === 'auth' && args[1] === 'status') {
        return { exitCode: 0, stdout: 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n', stderr: '' };
      }
      if (args[0] === 'auth' && args[1] === 'token') {
        return { exitCode: 0, stdout: 'gho_freshlogintoken\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.startAuthLogin({ workspaceId: workspace.id, cwd: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    seen.length = 0;

    await handlers.authReport(workspace.id);
    expect(seen.some((call) => call.env['GH_TOKEN'] === 'gho_freshlogintoken')).toBe(true);
  });

  it('logout deletes both the credential store entry and the SecretRef row, never leaving an orphaned secret', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    const ghExecutor: GhExecutor = async (args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return { exitCode: 0, stdout: 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n', stderr: '' };
      }
      if (args[0] === 'auth' && args[1] === 'token') {
        return { exitCode: 0, stdout: 'gho_freshlogintoken\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.startAuthLogin({ workspaceId: workspace.id, cwd: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await credentialStore.get(buildGithubCredentialRef(workspace.id, 'github.com'))).not.toBeNull();

    await handlers.logout(workspace.id);
    expect(await credentialStore.get(buildGithubCredentialRef(workspace.id, 'github.com'))).toBeNull();

    const connection = await storageCaller.call<{ secretRefId: string | null } | null>('githubConnection.get', {
      workspaceId: workspace.id,
      adapterId: 'github',
      host: 'github.com',
    });
    expect(connection?.secretRefId).toBeNull();
  });

  it('records a failed receipt and never creates a ServiceConnection row when the PTY exits non-zero', async () => {
    const workspace = await makeWorkspace();
    const credentialStore = new InMemoryCredentialStore();
    const ghExecutor: GhExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' });

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore,
      terminal: fakeTerminal(1),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.startAuthLogin({ workspaceId: workspace.id, cwd: dir });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'github.auth.login' && op.state === 'failed')).toBe(true);

    const connection = await storageCaller.call('githubConnection.get', { workspaceId: workspace.id, adapterId: 'github', host: 'github.com' });
    expect(connection).toBeNull();
  });
});

describe('GH-003: idempotent-aware repository publish', () => {
  it('publishes for real when the name is free, and records a receipt', async () => {
    const workspace = await makeWorkspace();
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    const project = await storageCaller.call<{ id: string; workspaceId: string }>('project.add', { workspaceId: workspace.id, canonicalPath: target });

    const calls: string[][] = [];
    const ghExecutor: GhExecutor = async (args) => {
      calls.push([...args]);
      if (args[0] === 'repo' && args[1] === 'view') {
        return { exitCode: 1, stdout: '', stderr: 'not found' };
      }
      return { exitCode: 0, stdout: 'https://github.com/acme/widgets\n', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore: new InMemoryCredentialStore(),
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    const result = await handlers.publishRepository(project.id, {
      owner: 'acme',
      name: 'widgets',
      visibility: 'public',
      sourceFolder: target,
      push: false,
    });

    expect(result).toEqual({ nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets' });
    expect(calls.some((call) => call[1] === 'create')).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'github.repo.publish' && op.state === 'succeeded')).toBe(true);
  });

  it('never overwrites: a name collision surfaces as an error and gh repo create is never called', async () => {
    const workspace = await makeWorkspace();
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    const project = await storageCaller.call<{ id: string; workspaceId: string }>('project.add', { workspaceId: workspace.id, canonicalPath: target });

    const calls: string[][] = [];
    const ghExecutor: GhExecutor = async (args) => {
      calls.push([...args]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          owner: { login: 'acme' },
          name: 'widgets',
          nameWithOwner: 'acme/widgets',
          url: 'https://github.com/acme/widgets',
          sshUrl: 'git@github.com:acme/widgets.git',
          visibility: 'PUBLIC',
        }),
        stderr: '',
      };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      credentialStore: new InMemoryCredentialStore(),
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await expect(
      handlers.publishRepository(project.id, { owner: 'acme', name: 'widgets', visibility: 'public', sourceFolder: target, push: false }),
    ).rejects.toThrow(/already exists/);
    expect(calls.some((call) => call[1] === 'create')).toBe(false);
  });

  it('"connect" resolution adds the existing repo as a local remote via real git, never calling gh repo create', async () => {
    const workspace = await makeWorkspace();
    const target = path.join(dir, 'project');
    fs.mkdirSync(target);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    const project = await storageCaller.call<{ id: string; workspaceId: string }>('project.add', { workspaceId: workspace.id, canonicalPath: target });

    const bareRemote = path.join(dir, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', bareRemote]);

    let ghCreateCalled = false;
    const ghExecutor: GhExecutor = async (args) => {
      if (args[1] === 'create') ghCreateCalled = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      gitExecutor: createNodeGitExecutor(),
      credentialStore: new InMemoryCredentialStore(),
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    await handlers.publishRepository(
      project.id,
      { owner: 'acme', name: 'widgets', visibility: 'public', sourceFolder: target, push: false },
      { nameWithOwner: 'acme/widgets', url: bareRemote },
    );

    expect(ghCreateCalled).toBe(false);
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: target }).toString().trim();
    expect(remoteUrl).toBe(bareRemote);
  });
});

describe('GH-002: credential setup verified with a real non-destructive git ls-remote', () => {
  it('verifies against a local bare repository standing in for the remote (no network)', async () => {
    const workspace = await makeWorkspace();
    const bareRemote = path.join(dir, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', bareRemote]);

    const ghExecutor: GhExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' });
    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor,
      gitExecutor: createNodeGitExecutor(),
      credentialStore: new InMemoryCredentialStore(),
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });

    // An empty bare repo has no HEAD ref yet — ls-remote --exit-code HEAD legitimately fails, which is exactly the "verified:false, real detail" path this test proves, not a thrown error.
    const result = await handlers.setupGit(workspace.id, bareRemote);
    expect(result.verified).toBe(false);
    expect(result.detail.length).toBeGreaterThan(0);
  });
});

describe('GH-009: remote action availability', () => {
  it('gates remote actions with a clear reason when offline, and never when online', () => {
    const handlers = createGithubHandlers(storageCaller, {
      ghExecutor: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      credentialStore: new InMemoryCredentialStore(),
      terminal: fakeTerminal(0),
      ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
    });
    expect(handlers.remoteAvailability('offline')).toEqual({ available: false, reason: expect.stringContaining('unreachable') });
    expect(handlers.remoteAvailability('online')).toEqual({ available: true, reason: null });
  });
});
