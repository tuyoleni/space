import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import { createNodeGitExecutor } from './node-git-executor';
import { createAndPushTag, createAnnotatedTag, createAnnotatedTagArgs, listTags, parseTagRefs, pushTag, pushTagArgs } from './tag';

const FS = '\x1f';
const RS = '\x1e';

describe('createAnnotatedTagArgs / pushTagArgs', () => {
  it('builds an annotated tag command with message', () => {
    expect(createAnnotatedTagArgs({ name: 'v1.2.3', message: 'Release 1.2.3' })).toEqual(['tag', '-a', 'v1.2.3', '-m', 'Release 1.2.3']);
  });

  it('includes an explicit ref when supplied', () => {
    expect(createAnnotatedTagArgs({ name: 'v1.2.3', message: 'Release', ref: 'abc123' })).toEqual([
      'tag',
      '-a',
      'v1.2.3',
      '-m',
      'Release',
      '--',
      'abc123',
    ]);
  });

  it('rejects a tag name that looks like a flag', () => {
    expect(() => createAnnotatedTagArgs({ name: '-x', message: 'm' })).toThrow();
  });

  it('builds a push command scoped to the tag ref', () => {
    expect(pushTagArgs('origin', 'v1.2.3')).toEqual(['push', '--', 'origin', 'v1.2.3']);
  });
});

describe('createAnnotatedTag / pushTag / createAndPushTag', () => {
  it('creates for real through the injected executor and throws on failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 128, stdout: '', stderr: "fatal: tag 'v1.2.3' already exists" }));
    await expect(createAnnotatedTag('/repo', { name: 'v1.2.3', message: 'Release' }, executor)).rejects.toThrow(/already exists/);
  });

  it('creates then pushes in order', async () => {
    const calls: string[][] = [];
    const executor: GitExecutor = vi.fn(async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await createAndPushTag('/repo', 'origin', { name: 'v1.2.3', message: 'Release 1.2.3' }, executor);
    expect(calls[0]).toEqual(['tag', '-a', 'v1.2.3', '-m', 'Release 1.2.3']);
    expect(calls[1]).toEqual(['push', '--', 'origin', 'v1.2.3']);
  });

  it('pushTag throws with the real stderr on failure', async () => {
    const executor: GitExecutor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'remote: permission denied' }));
    await expect(pushTag('/repo', 'origin', 'v1.2.3', executor)).rejects.toThrow(/permission denied/);
  });
});

describe('parseTagRefs', () => {
  it('prefers the peeled *objectname for an annotated tag and converts unix seconds to ms', () => {
    const record = `v1.0.0${FS}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${FS}bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${FS}Release 1.0.0${FS}1700000000${RS}`;
    expect(parseTagRefs(record)).toEqual([
      { name: 'v1.0.0', targetSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', subject: 'Release 1.0.0', taggedAt: 1700000000000 },
    ]);
  });

  it('falls back to objectname for a lightweight tag and nulls an empty subject/date', () => {
    const record = `v0.1${FS}cccccccccccccccccccccccccccccccccccccccc${FS}${FS}${FS}${RS}`;
    expect(parseTagRefs(record)).toEqual([
      { name: 'v0.1', targetSha: 'cccccccccccccccccccccccccccccccccccccccc', subject: null, taggedAt: null },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(parseTagRefs('')).toEqual([]);
  });
});

describe('listTags against a real repo', () => {
  let dir: string;
  let git: GitExecutor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-tag-'));
    git = createNodeGitExecutor();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'fixture@space.test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when there are no tags', async () => {
    await expect(listTags(dir, git)).resolves.toEqual([]);
  });

  it('lists a real annotated tag pointing at the head commit with its subject and date', async () => {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'First release'], { cwd: dir });

    const tags = await listTags(dir, git);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe('v1.0.0');
    expect(tags[0]?.targetSha).toBe(headSha);
    expect(tags[0]?.subject).toBe('First release');
    expect(tags[0]?.taggedAt).toBeGreaterThan(0);
  });

  it('lists a real lightweight tag with the commit as its target', async () => {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    execFileSync('git', ['tag', 'v0.1'], { cwd: dir });

    const [tag] = await listTags(dir, git);
    expect(tag?.name).toBe('v0.1');
    expect(tag?.targetSha).toBe(headSha);
  });
});
