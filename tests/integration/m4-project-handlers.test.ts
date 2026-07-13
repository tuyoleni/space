/**
 * M4: createProjectHandlers exercised end to end against a real temp-
 * directory SQLite database (via handleStorageRequest, the same code path
 * the storage worker runs — mirrors m2-storage-handlers.test.ts) and real
 * child processes (git clone against a local fixture repo, npm install
 * with no dependencies, npm init --yes). No Electron utilityProcess is
 * involved; `StorageCaller` is deliberately a minimal interface so this
 * test can supply a fake that calls straight into the real storage layer.
 *
 * This proves the trust gate is a structural gate, not a convention:
 * installDependencies/startDevServer both throw for an untrusted project
 * unless allowOnce is set, before any process is spawned.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project, Workspace } from '@space/contracts';
import { createStorage, type Storage } from '@space/storage';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import { createProjectHandlers, type StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m4-handlers-'));
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

describe('createFromTemplate + clone (PRJ-001/004)', () => {
  it('creates a real project from the node-minimal template and registers it untrusted', async () => {
    const workspace = await makeWorkspace();
    const handlers = createProjectHandlers(storageCaller);

    const project = await handlers.createFromTemplate({
      workspaceId: workspace.id,
      templateId: 'node-minimal',
      destinationParentDirectory: dir,
      name: 'created-app',
    });

    expect(project.trustState).toBe('untrusted');
    expect(fs.existsSync(path.join(dir, 'created-app', 'package.json'))).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.createFromTemplate' && op.state === 'succeeded')).toBe(true);
  });

  it('clones a real local fixture repository and registers it untrusted', async () => {
    const workspace = await makeWorkspace();
    const sourceRepo = path.join(dir, 'source');
    fs.mkdirSync(sourceRepo);
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: sourceRepo });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: sourceRepo });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: sourceRepo });
    fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRepo });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: sourceRepo });

    const handlers = createProjectHandlers(storageCaller);
    const project = await handlers.clone({
      workspaceId: workspace.id,
      remoteUrl: sourceRepo,
      destinationParentDirectory: dir,
      name: 'cloned-app',
    });

    expect(project.trustState).toBe('untrusted');
    // M8: canonicalPath is now resolved through fs.realpathSync (spec 30.3
    // "treat symlinks explicitly") — see m2-storage-handlers.test.ts's
    // matching comment for why this must resolve the same way on macOS.
    expect(project.repositoryRoot).toBe(fs.realpathSync(path.join(dir, 'cloned-app')));
    expect(fs.readFileSync(path.join(dir, 'cloned-app', 'README.md'), 'utf-8')).toBe('# fixture\n');

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.clone' && op.state === 'succeeded')).toBe(true);
  });
});

describe('installDependencies is gated by trust (PRJ-003 structural gate)', () => {
  it('refuses to install for an untrusted project without ever spawning npm', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });
    expect(project.trustState).toBe('untrusted');

    const handlers = createProjectHandlers(storageCaller);
    await expect(handlers.installDependencies({ projectId: project.id })).rejects.toThrow(/untrusted/);
    expect(fs.existsSync(path.join(projectDir, 'node_modules'))).toBe(false);
  });

  it('allow-once permits exactly one install without trusting the project permanently', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    const result = await handlers.installDependencies({ projectId: project.id, packageManager: 'npm', allowOnce: true });
    expect(result.succeeded).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'package-lock.json'))).toBe(true);

    const reread = await storageCaller.call<Project>('project.get', { projectId: project.id });
    expect(reread.trustState).toBe('untrusted');
  }, 30000);

  it('installs for real once the project is explicitly trusted', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    const trusted = await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    expect(trusted.trustState).toBe('trusted');

    const result = await handlers.installDependencies({ projectId: project.id, packageManager: 'npm' });
    expect(result.succeeded).toBe(true);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'project.installDependencies' && op.state === 'succeeded')).toBe(true);
  }, 30000);
});

describe('startDevServer is gated by trust and requires a real dev/start script', () => {
  it('refuses to start a dev server for an untrusted project', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node -e "console.log(1)"' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await expect(handlers.startDevServer({ projectId: project.id })).rejects.toThrow(/untrusted/);
  });

  it('throws a clear error when there is no dev/start script, even if trusted', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    await expect(handlers.startDevServer({ projectId: project.id })).rejects.toThrow(/No "dev" or "start" script/);
  });
});

describe('startDevServer fires onDevProcessExited (M8 spec 18.2 "Development process exited" trigger)', () => {
  it('calls the injected hook with workspace/project scope and the real exit code once the process exits', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node -e "process.exit(0)"' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const exitEvents: Array<{
      workspaceId: string;
      projectId: string;
      devProcessId: string;
      exitCode: number | null;
      state: 'stopped' | 'crashed';
    }> = [];
    let resolveExit: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const handlers = createProjectHandlers(storageCaller, {
      onDevProcessExited: (event) => {
        exitEvents.push(event);
        resolveExit?.();
      },
    });
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    await handlers.startDevServer({ projectId: project.id });

    await exited;
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0]).toMatchObject({ workspaceId: workspace.id, projectId: project.id, exitCode: 0, state: 'stopped' });
  }, 15000);
});

/**
 * Regression coverage for the manually-reported bug: "stop dev server ...
 * says stop dev server after i start when i click stop iy then showing the
 * link on button". Root cause was stopDevServer() resolving as soon as
 * SIGTERM was sent, before the process had actually exited and before its
 * `devProcess.markStopped` write had landed — so a renderer refresh right
 * after stop() resolved could still read `state: 'running'`. This spawns a
 * real, genuinely long-lived Node HTTP server (never a fixed real port —
 * `listen(0, ...)`) whose SIGTERM handler deliberately delays its exit, so
 * the old race window is actually observable rather than accidentally too
 * fast to hit.
 */
describe('stopDevServer waits for the real process exit and its persisted state (race fix)', () => {
  const DEV_SERVER_SCRIPT = `
const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
server.listen(0, '127.0.0.1', () => {
  console.log('Local: http://localhost:' + server.address().port + '/');
});
// Deliberately delayed shutdown — makes the fixed-vs-buggy race window
// actually observable instead of the process happening to exit before the
// test gets a chance to query storage.
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 75));
`;

  it('shows the dev server as stopped, not running, immediately after stop() resolves', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(projectDir, 'server.js'), DEV_SERVER_SCRIPT);
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node server.js' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    const record = await handlers.startDevServer({ projectId: project.id });
    expect(record.state).toBe('running');

    // Wait for the real listening URL so we know the server is genuinely
    // up (and its process fully spawned) before stopping it — mirrors how
    // a real user would only click "Stop" once the server had started.
    await expect
      .poll(
        async () => {
          const [devProcess] = await handlers.listDevServers(project.id);
          return devProcess?.detectedUrl ?? null;
        },
        { timeout: 5000 },
      )
      .toMatch(/^http:\/\/localhost:\d+\/$/);

    await handlers.stopDevServer({ devProcessId: record.id });

    // The crux of the fix: query immediately after stop() resolves, with
    // no additional wait — this must already reflect the persisted
    // terminal state, not race the async exit handler.
    const [afterStop] = await handlers.listDevServers(project.id);
    expect(afterStop.state).toBe('stopped');
    expect(afterStop.exitCode).toBe(0);
  }, 15000);

  it('escalates to SIGKILL and still resolves once the grace period elapses for a process that ignores SIGTERM', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    // Ignores SIGTERM entirely so stopDevServer() is forced through its
    // timeout-then-SIGKILL escalation path for real. Prints a fake
    // "listening" line immediately so the test can wait for the real
    // "npm run dev" -> node child chain to be genuinely up (SIGTERM
    // arriving before npm has even spawned the script isn't the scenario
    // under test here) before requesting a stop — mirrors how a real user
    // would only click "Stop" once the server has actually started.
    fs.writeFileSync(
      path.join(projectDir, 'server.js'),
      "console.log('Local: http://localhost:1/'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    );
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node server.js' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    const record = await handlers.startDevServer({ projectId: project.id });

    await expect
      .poll(
        async () => {
          const [devProcess] = await handlers.listDevServers(project.id);
          return devProcess?.detectedUrl ?? null;
        },
        { timeout: 5000 },
      )
      .toBe('http://localhost:1/');

    const startedAt = Date.now();
    await handlers.stopDevServer({ devProcessId: record.id });
    const elapsedMs = Date.now() - startedAt;

    // It was still an explicitly-requested stop (SIGKILL was only the
    // escalation path, not a spontaneous crash), so the persisted state is
    // 'stopped', not 'crashed' — the fix's timeout forced it to actually
    // happen instead of the promise resolving early. A signal-terminated
    // process reports a null exit code, never 0.
    const [afterStop] = await handlers.listDevServers(project.id);
    expect(afterStop.state).toBe('stopped');
    expect(afterStop.exitCode).toBeNull();
    // Bounded: proves this didn't hang forever waiting on a process that
    // will never voluntarily exit on its own, and that it really did take
    // the timeout-then-escalate path (a deliberately non-trivial wait)
    // rather than exiting immediately.
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);
});

describe('startDevServer detects a listening URL split across chunk boundaries (PRJ-006)', () => {
  it('still finds the URL when the process writes it in two separate, genuinely split stdout writes', async () => {
    const workspace = await makeWorkspace();
    const projectDir = fs.mkdtempSync(path.join(dir, 'proj-'));
    // Split mid-scheme, exactly like packages/workspace-runner's
    // detached.test.ts split-write regression test — neither half alone
    // contains anything detectListeningUrl can match.
    fs.writeFileSync(
      path.join(projectDir, 'server.js'),
      [
        "process.stdout.write('Local:   ht');",
        "setTimeout(() => process.stdout.write('tp://localhost:5199/\\n'), 50);",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'node server.js' } }),
    );
    const project = await storageCaller.call<Project>('project.add', { workspaceId: workspace.id, canonicalPath: projectDir });

    const handlers = createProjectHandlers(storageCaller);
    await handlers.trustDecision({ projectId: project.id, decision: 'trust-this-project' });
    const record = await handlers.startDevServer({ projectId: project.id });

    await expect
      .poll(
        async () => {
          const [devProcess] = await handlers.listDevServers(project.id);
          return devProcess?.detectedUrl ?? null;
        },
        { timeout: 5000 },
      )
      .toBe('http://localhost:5199/');

    await handlers.stopDevServer({ devProcessId: record.id });
  }, 15000);
});
