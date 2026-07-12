/**
 * P0-C technical spike (spec section 36.1.3).
 *
 * Exit criteria: the same typed operation runs with two different
 * workspace Git identities without modifying the normal global Git
 * configuration. Also proves redaction, cancellation, and receipts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildEnvironment } from '@space/domain';
import { RedactionRegistry, runProcess } from '@space/workspace-runner';

const GIT = 'git';

interface SpikeWorkspace {
  readonly id: string;
  readonly gitConfigPath: string;
  readonly authorName: string;
  readonly authorEmail: string;
}

let root: string;
let workspaceA: SpikeWorkspace;
let workspaceB: SpikeWorkspace;

const resolveExecutable = async (executableId: string): Promise<string> => {
  if (executableId !== 'git') {
    throw new Error(`Unknown executable id: ${executableId}`);
  }
  return GIT;
};

function workspaceEnvironment(ws: SpikeWorkspace): Record<string, string> {
  return buildEnvironment({
    osBase: process.env as Record<string, string>,
    machineToolPaths: {},
    workspaceToolConfig: {
      // Official Git mechanism (spec section 5.4): scope "global" config
      // to a workspace-owned file instead of rewriting ~/.gitconfig.
      GIT_CONFIG_GLOBAL: ws.gitConfigPath,
      // Never read /etc/gitconfig either - keep the spike hermetic.
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
    workspaceVars: { SPACE_WORKSPACE_ID: ws.id },
    projectVars: {},
    secrets: {},
    operationVars: {},
    policy: {
      inheritAllowList: ['PATH', 'HOME', 'LANG', 'TMPDIR'],
      denyList: [],
    },
  });
}

async function createWorkspace(id: string, name: string, email: string): Promise<SpikeWorkspace> {
  const dir = path.join(root, id, 'git');
  await fs.mkdir(dir, { recursive: true });
  const gitConfigPath = path.join(dir, 'config');
  await fs.writeFile(
    gitConfigPath,
    `[user]\n\tname = ${name}\n\temail = ${email}\n[init]\n\tdefaultBranch = main\n`,
    'utf-8',
  );
  return { id, gitConfigPath, authorName: name, authorEmail: email };
}

/** The "same typed operation": init a repo and create one commit. */
async function initAndCommit(ws: SpikeWorkspace, repoDir: string): Promise<string> {
  await fs.mkdir(repoDir, { recursive: true });
  const env = workspaceEnvironment(ws);

  const run = (operationId: string, args: string[]) =>
    runProcess(
      { operationId, workspaceId: ws.id, executableId: 'git', args, cwd: repoDir, env },
      { resolveExecutable },
    );

  expect((await run('op-init', ['init', '-b', 'main'])).state).toBe('succeeded');
  await fs.writeFile(path.join(repoDir, 'README.md'), `# spike ${ws.id}\n`, 'utf-8');
  expect((await run('op-add', ['add', 'README.md'])).state).toBe('succeeded');
  expect((await run('op-commit', ['commit', '-m', 'P0-C spike commit'])).state).toBe('succeeded');

  const log = await run('op-log', ['log', '-1', '--format=%an <%ae>']);
  expect(log.state).toBe('succeeded');
  return log.stdout.trim();
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'space-p0c-'));
  workspaceA = await createWorkspace('ws-a', 'Workspace A Author', 'a@workspace-a.test');
  workspaceB = await createWorkspace('ws-b', 'Workspace B Author', 'b@workspace-b.test');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('P0-C: environment runner (spec section 36.1.3)', () => {
  it('runs the same typed operation under two distinct workspace Git identities', async () => {
    const globalConfigPath = path.join(os.homedir(), '.gitconfig');
    const before = await fs.readFile(globalConfigPath, 'utf-8').catch(() => '<absent>');

    const authorA = await initAndCommit(workspaceA, path.join(root, 'ws-a', 'repo'));
    const authorB = await initAndCommit(workspaceB, path.join(root, 'ws-b', 'repo'));

    expect(authorA).toBe('Workspace A Author <a@workspace-a.test>');
    expect(authorB).toBe('Workspace B Author <b@workspace-b.test>');

    const after = await fs.readFile(globalConfigPath, 'utf-8').catch(() => '<absent>');
    expect(after).toBe(before);
  });

  it('produces a receipt with redacted output', async () => {
    const redaction = new RedactionRegistry();
    redaction.register('super-secret-value');
    const receipt = await runProcess(
      {
        operationId: 'op-redact',
        workspaceId: workspaceA.id,
        executableId: 'git',
        args: ['config', '--file', workspaceA.gitConfigPath, 'x.secretprobe', 'super-secret-value'],
        env: workspaceEnvironment(workspaceA),
      },
      { resolveExecutable, redaction },
    );
    expect(receipt.state).toBe('succeeded');
    expect(receipt.commandDisplay).toContain('[REDACTED]');
    expect(receipt.commandDisplay).not.toContain('super-secret-value');
  });

  it('supports cancellation and reports it distinctly from failure', async () => {
    const controller = new AbortController();
    const pending = runProcess(
      {
        operationId: 'op-cancel',
        workspaceId: workspaceA.id,
        executableId: 'git',
        // git daemon listens until killed - a reliable long-running
        // process for exercising cancellation without network access.
        args: ['daemon', '--port=0', '--base-path=.'],
        cwd: root,
        env: workspaceEnvironment(workspaceA),
      },
      { resolveExecutable, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 300);
    const receipt = await pending;
    expect(receipt.state).toBe('cancelled');
  }, 15000);
});
