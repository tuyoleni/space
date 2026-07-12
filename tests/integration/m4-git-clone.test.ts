/**
 * M4: real `git clone` against a local, hermetic fixture repository — no
 * network access (spec section 39's ban on fixture-faked production code
 * means `cloneRepository` itself is real; the *source repo* is a scratch
 * `git init` fixture created and torn down entirely inside a temp
 * directory, matching how tests/integration/p0d-git-graph.test.ts
 * generates its own fixture repository rather than hitting the network).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneRepository, createNodeGitExecutor } from '@space/git-engine';

let dir: string;
let sourceRepo: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m4-clone-'));
  sourceRepo = path.join(dir, 'source');
  fs.mkdirSync(sourceRepo);
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: sourceRepo });
  execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: sourceRepo });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: sourceRepo });
  fs.writeFileSync(path.join(sourceRepo, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: sourceRepo });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: sourceRepo });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloneRepository against a real local fixture repository', () => {
  it('clones a real commit history with the real git executable', async () => {
    const destination = path.join(dir, 'clone');
    const executor = createNodeGitExecutor();

    const result = await cloneRepository({ remoteUrl: sourceRepo, destination }, executor);

    expect(result.destination).toBe(destination);
    expect(fs.existsSync(path.join(destination, '.git'))).toBe(true);
    expect(fs.readFileSync(path.join(destination, 'README.md'), 'utf-8')).toBe('# fixture\n');

    const log = execFileSync('git', ['log', '--oneline'], { cwd: destination }).toString();
    expect(log).toContain('initial commit');
  });

  it('clones a specific branch when requested', async () => {
    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: sourceRepo });
    fs.writeFileSync(path.join(sourceRepo, 'feature.txt'), 'feature work\n');
    execFileSync('git', ['add', 'feature.txt'], { cwd: sourceRepo });
    execFileSync('git', ['commit', '-m', 'feature commit'], { cwd: sourceRepo });

    const destination = path.join(dir, 'clone-feature');
    const executor = createNodeGitExecutor();
    await cloneRepository({ remoteUrl: sourceRepo, destination, branch: 'feature' }, executor);

    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: destination }).toString().trim();
    expect(branch).toBe('feature');
    expect(fs.existsSync(path.join(destination, 'feature.txt'))).toBe(true);
  });

  it('rejects a non-existent source with a clear error and leaves no partial clone claimed as success', async () => {
    const destination = path.join(dir, 'clone-missing');
    const executor = createNodeGitExecutor();
    await expect(
      cloneRepository({ remoteUrl: path.join(dir, 'does-not-exist'), destination }, executor),
    ).rejects.toThrow(/git clone failed/);
  });
});
