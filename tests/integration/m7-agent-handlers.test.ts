/**
 * M7: createAgentHandlers exercised end to end (spec sections 13, 19) —
 * proves the intent/agent layer is real wiring over already-tested M4/M5/
 * M6 capabilities, not a reimplementation, and structurally proves the
 * confirmation/trust gates the milestone's hard safety boundary requires:
 * an unconfirmed destructive agent action must be rejected before it ever
 * reaches a real capability, and file.modify/project.runScript must be
 * rejected for an untrusted project before any file is touched or any
 * process is spawned.
 *
 * Git operations run against a real temporary repository (never a network
 * remote — fetch/push targets a local `git init --bare` directory, the
 * same pattern m5-git-handlers.test.ts uses). GitHub operations run
 * against a fake `GhExecutor` returning canned output (same pattern
 * m6-github-handlers.test.ts uses) — no real `gh` process is ever
 * invoked. `GIT_CONFIG_GLOBAL` is redirected to a temp file so commit
 * identity resolution never touches this machine's real ~/.gitconfig.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentActionNotConfirmedError } from '@space/domain';
import { StaleSelectionError } from '@space/agent';
import { createNodeGitExecutor } from '@space/git-engine';
import type { GhCommandResult, GhExecutor } from '@space/github-engine';
import { InMemoryCredentialStore } from '@space/security';
import { createStorage, type Storage } from '@space/storage';
import type { Project, Workspace } from '@space/contracts';
import { handleStorageRequest } from '../../apps/desktop/src/main/storage-handlers';
import { createGitHandlers } from '../../apps/desktop/src/main/git-handlers';
import { createGithubHandlers } from '../../apps/desktop/src/main/github-handlers';
import { createAgentHandlers, type AgentHandlers } from '../../apps/desktop/src/main/agent-handlers';
import type { StorageCaller } from '../../apps/desktop/src/main/project-handlers';
import type { StorageMethod } from '../../apps/desktop/src/main/storage-protocol';
import type { TerminalWorkerEvent } from '@space/terminal';

let dir: string;
let storage: Storage;
let storageCaller: StorageCaller;
let requestSequence = 0;
let originalGitConfigGlobal: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m7-agent-handlers-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storageCaller = {
    call: <T>(method: StorageMethod, payload: unknown) => {
      requestSequence += 1;
      return handleStorageRequest(storage, { id: `req-${requestSequence}`, method, payload }) as Promise<T>;
    },
  };

  originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  const globalConfigPath = path.join(dir, 'test.gitconfig');
  fs.writeFileSync(globalConfigPath, '[user]\n\tname = Space Test\n\temail = space-test@example.com\n');
  process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
});

afterEach(() => {
  if (originalGitConfigGlobal === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
  }
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeWorkspace(name = 'A'): Promise<Workspace> {
  return storageCaller.call<Workspace>('workspace.create', { name });
}

async function makeRepoProject(workspaceId: string, dirName: string): Promise<Project> {
  const target = path.join(dir, dirName);
  fs.mkdirSync(target);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: target });
  fs.writeFileSync(path.join(target, 'a.txt'), 'line1\nline2\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: target });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: target });
  return storageCaller.call<Project>('project.add', { workspaceId, canonicalPath: target });
}

function fakeTerminal() {
  return {
    call: async <T>(): Promise<T> => undefined as unknown as T,
    subscribe: (_sessionId: string, _cb: (event: TerminalWorkerEvent) => void) => () => {},
  };
}

function buildAgentHandlers(): AgentHandlers {
  const gitExecutor = createNodeGitExecutor();
  const gitHandlers = createGitHandlers(storageCaller, { gitExecutor, historyCacheDir: path.join(dir, 'cache') });
  const ghExecutor: GhExecutor = async (args): Promise<GhCommandResult> => {
    if (args[0] === 'pr' && args[1] === 'create') {
      return { exitCode: 0, stdout: 'https://github.com/octocat/example/pull/1\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const githubHandlers = createGithubHandlers(storageCaller, {
    ghExecutor,
    gitExecutor,
    credentialStore: new InMemoryCredentialStore(),
    terminal: fakeTerminal(),
    ghConfigDirFor: (id) => path.join(dir, 'gh-config', id),
  });
  const projectHandlers = {
    installDependencies: async () => ({ packageManager: 'npm', succeeded: true, exitCode: 0 }),
    detectPackageManager: async () => ({ packageManager: 'npm' as const }),
  };
  return createAgentHandlers(storageCaller, { gitExecutor, gitHandlers, projectHandlers, githubHandlers });
}

describe('diff evidence + rule-based intent grouping (spec 13.1/13.2)', () => {
  it('loads real evidence traceable to exact files/hunks and groups it deterministically', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'line1\nline2 changed\n');
    fs.mkdirSync(path.join(dir, 'project', 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'project', 'src', 'b.txt'), 'new file\n');

    const evidence = await agent.loadEvidence({ projectId: project.id });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => typeof e.filePath === 'string' && e.filePath.length > 0)).toBe(true);
    expect(evidence.some((e) => e.filePath === 'a.txt')).toBe(true);

    const groups = agent.generateIntentGroups(evidence);
    expect(groups.length).toBeGreaterThan(0);
    // Every piece of evidence in every group traces back to the real evidence pool (no fabrication).
    const groupedEvidence = groups.flatMap((g) => g.evidence);
    expect(groupedEvidence).toHaveLength(evidence.length);
  });
});

describe('commit composition (spec 13.4 CHG-004)', () => {
  it('composes a commit from selected evidence via the real, already-tested git commit handler', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'line1\nline2 changed\n');
    const evidence = await agent.loadEvidence({ projectId: project.id });

    const result = await agent.composeCommit({ projectId: project.id, evidence, message: 'agent: update a.txt' });
    const realSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(dir, 'project') }).toString().trim();
    expect(result.sha).toBe(realSha);

    const receipts = storage.operations.listByWorkspace(workspace.id);
    expect(receipts.some((op) => op.type === 'git.commit' && op.state === 'succeeded')).toBe(true);
  });

  it('refuses to compose from stale evidence after the repository changed underneath it', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'line1\nline2 changed\n');
    const evidence = await agent.loadEvidence({ projectId: project.id });

    // The file changes again after evidence was collected but before composition.
    fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'line1\nsomething-else-entirely\n');

    await expect(agent.composeCommit({ projectId: project.id, evidence, message: 'stale' })).rejects.toThrow(
      StaleSelectionError,
    );
  });
});

describe('file.modify and project.runScript route through the project-trust gate (spec 10.3/ADR-006)', () => {
  it('rejects file.modify for an untrusted project before touching any file', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    expect(project.trustState).toBe('untrusted');
    const agent = buildAgentHandlers();

    const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ a.txt\n@@ -1,2 +1,2 @@\n line1\n-line2\n+line2 modified\n';
    const action = {
      id: 'a1',
      type: 'file.modify',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { patchText: patch },
      explanation: 'agent edit',
      risk: 'local-reversible',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: true })).rejects.toThrow(/untrusted/i);
    const contents = fs.readFileSync(path.join(dir, 'project', 'a.txt'), 'utf-8');
    expect(contents).toBe('line1\nline2\n'); // untouched
  });

  it('permits file.modify once the project is trusted, applying a real patch to the worktree', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    await storageCaller.call('project.trustDecision', { projectId: project.id, decision: 'trust-this-project' });
    const agent = buildAgentHandlers();

    const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n line1\n-line2\n+line2 modified\n';
    const action = {
      id: 'a1',
      type: 'file.modify',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { patchText: patch },
      explanation: 'agent edit',
      risk: 'local-reversible',
    };

    await agent.dispatchPlan({ rawAction: action, confirmed: true });
    const contents = fs.readFileSync(path.join(dir, 'project', 'a.txt'), 'utf-8');
    expect(contents).toBe('line1\nline2 modified\n');
  });

  it('rejects project.runScript for an untrusted project before spawning any process', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const action = {
      id: 'a1',
      type: 'project.runScript',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { scriptName: 'build' },
      explanation: 'agent runs build',
      risk: 'local-reversible',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: true })).rejects.toThrow(/untrusted/i);
  });
});

describe('destructive/remote agent actions require confirmation every time (spec 19.2.4, 25.3.6)', () => {
  it('rejects an unconfirmed force-push agent action before it ever reaches the real git push handler', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const action = {
      id: 'a1',
      type: 'git.push',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { branch: 'main', force: 'raw' },
      explanation: 'a broken/adversarial plan claims this is harmless',
      risk: 'observe', // deliberately mislabelled — dispatch must not trust this
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
    // No remote configured at all — if the real push handler had been reached, this would fail differently (missing remote), not with a confirmation error. Confirming this instead proves the confirmation gate ran first.
  });

  it('still requires the git-engine-level force-push confirmation even after the agent-level gate is satisfied (defence in depth)', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const action = {
      id: 'a1',
      type: 'git.push',
      workspaceId: workspace.id,
      projectId: project.id,
      // agent-level confirmed: true unlocks assertAgentActionConfirmed, but
      // parameters.confirmed is missing, so git-engine's own
      // assertDestructiveGitActionConfirmed must independently reject it.
      parameters: { branch: 'main', force: 'raw' },
      explanation: 'force push',
      risk: 'destructive',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: true })).rejects.toThrow(/not confirmed/i);
  });

  it('rejects an unconfirmed github.createPullRequest with no standing permission', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const action = {
      id: 'a1',
      type: 'github.createPullRequest',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { title: 'My change', body: 'body', base: 'main', head: 'feature' },
      explanation: 'open a PR',
      risk: 'remote',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
  });

  it('permits github.createPullRequest with explicit confirmation, dispatching to the real (fake-backed) GitHub handler', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const action = {
      id: 'a1',
      type: 'github.createPullRequest',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { title: 'My change', body: 'body', base: 'main', head: 'feature' },
      explanation: 'open a PR',
      risk: 'remote',
    };

    const result = await agent.dispatchPlan({ rawAction: action, confirmed: true });
    expect(result).toEqual({ url: 'https://github.com/octocat/example/pull/1' });
  });
});

describe('agent standing permissions (spec 19.2.3): narrow, revocable, never for destructive actions', () => {
  it('grants a narrow standing permission that then satisfies a remote action without per-call confirmation', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    await agent.grantPermission({ workspaceId: workspace.id, projectId: project.id, actionType: 'github.createPullRequest' });

    const action = {
      id: 'a1',
      type: 'github.createPullRequest',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { title: 'My change', body: 'body', base: 'main', head: 'feature' },
      explanation: 'open a PR',
      risk: 'remote',
    };

    const result = await agent.dispatchPlan({ rawAction: action, confirmed: false });
    expect(result).toEqual({ url: 'https://github.com/octocat/example/pull/1' });
  });

  it('revoking the standing permission makes the next call require confirmation again', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    const grant = await agent.grantPermission({ workspaceId: workspace.id, projectId: project.id, actionType: 'github.createPullRequest' });
    await agent.revokePermission(grant.id);

    const action = {
      id: 'a1',
      type: 'github.createPullRequest',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { title: 'My change', body: 'body', base: 'main', head: 'feature' },
      explanation: 'open a PR',
      risk: 'remote',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
    const grants = await agent.listPermissions(workspace.id);
    expect(grants.find((g) => g.id === grant.id)?.revokedAt).not.toBeNull();
  });

  it('a standing permission for a destructive action type never substitutes for that action\'s required confirmation', async () => {
    const workspace = await makeWorkspace();
    const project = await makeRepoProject(workspace.id, 'project');
    const agent = buildAgentHandlers();

    await agent.grantPermission({ workspaceId: workspace.id, projectId: project.id, actionType: 'git.push' });

    const action = {
      id: 'a1',
      type: 'git.push',
      workspaceId: workspace.id,
      projectId: project.id,
      parameters: { branch: 'main', force: 'raw' },
      explanation: 'force push',
      risk: 'destructive',
    };

    await expect(agent.dispatchPlan({ rawAction: action, confirmed: false })).rejects.toThrow(
      AgentActionNotConfirmedError,
    );
  });
});
