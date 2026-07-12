import { describe, expect, it, vi } from 'vitest';
import type { GitExecutor } from './clone';
import { createAndPushTag, createAnnotatedTag, createAnnotatedTagArgs, pushTag, pushTagArgs } from './tag';

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
