import { describe, expect, it } from 'vitest';
import { createAndPublishRepository, findExistingRepository, planRepositoryPublish, repoCreateArgs, RepositoryAlreadyExistsError } from './repository';
import type { GhExecutor } from './executor';

describe('repoCreateArgs', () => {
  it('builds a public create command with source and remote', () => {
    expect(
      repoCreateArgs({ owner: 'acme', name: 'widgets', visibility: 'public', sourceFolder: '/proj', push: false }),
    ).toEqual(['repo', 'create', 'acme/widgets', '--public', '--source', '/proj', '--remote', 'origin']);
  });

  it('includes description, custom remote, and --push', () => {
    expect(
      repoCreateArgs({
        owner: 'acme',
        name: 'widgets',
        visibility: 'private',
        description: 'Widgets API',
        sourceFolder: '/proj',
        remoteName: 'upstream',
        push: true,
      }),
    ).toEqual([
      'repo',
      'create',
      'acme/widgets',
      '--private',
      '--description',
      'Widgets API',
      '--source',
      '/proj',
      '--remote',
      'upstream',
      '--push',
    ]);
  });

  it('rejects an owner or name that looks like a flag', () => {
    expect(() => repoCreateArgs({ owner: '-x', name: 'widgets', visibility: 'public', sourceFolder: '/p', push: false })).toThrow();
    expect(() => repoCreateArgs({ owner: 'acme', name: '--rm', visibility: 'public', sourceFolder: '/p', push: false })).toThrow();
  });
});

const REPO_VIEW_FIXTURE = {
  owner: { login: 'acme' },
  name: 'widgets',
  nameWithOwner: 'acme/widgets',
  url: 'https://github.com/acme/widgets',
  sshUrl: 'git@github.com:acme/widgets.git',
  visibility: 'PRIVATE',
};

describe('findExistingRepository', () => {
  it('parses gh repo view --json output when the repository exists', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['repo', 'view', 'acme/widgets', '--json', 'owner,name,nameWithOwner,url,sshUrl,visibility']);
      return { exitCode: 0, stdout: JSON.stringify(REPO_VIEW_FIXTURE), stderr: '' };
    };
    const info = await findExistingRepository(executor, 'acme', 'widgets');
    expect(info).toEqual({
      owner: 'acme',
      name: 'widgets',
      nameWithOwner: 'acme/widgets',
      url: 'https://github.com/acme/widgets',
      sshUrl: 'git@github.com:acme/widgets.git',
      visibility: 'PRIVATE',
    });
  });

  it('resolves to null (not an error) when the repository does not exist', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a Repository' });
    await expect(findExistingRepository(executor, 'acme', 'widgets')).resolves.toBeNull();
  });
});

describe('planRepositoryPublish', () => {
  it('plans "create" when no repository exists', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'not found' });
    expect(await planRepositoryPublish(executor, 'acme', 'widgets')).toEqual({ kind: 'create' });
  });

  it('plans "conflict" with the existing repo info when one already exists', async () => {
    const executor: GhExecutor = async () => ({ exitCode: 0, stdout: JSON.stringify(REPO_VIEW_FIXTURE), stderr: '' });
    const plan = await planRepositoryPublish(executor, 'acme', 'widgets');
    expect(plan.kind).toBe('conflict');
    expect(plan.kind === 'conflict' && plan.existing.nameWithOwner).toBe('acme/widgets');
  });
});

describe('createAndPublishRepository', () => {
  it('creates the repository when the name is free', async () => {
    const calls: string[][] = [];
    const executor: GhExecutor = async (args) => {
      calls.push([...args]);
      if (args[0] === 'repo' && args[1] === 'view') {
        return { exitCode: 1, stdout: '', stderr: 'not found' };
      }
      return { exitCode: 0, stdout: 'https://github.com/acme/widgets\n', stderr: '' };
    };
    const result = await createAndPublishRepository(executor, {
      owner: 'acme',
      name: 'widgets',
      visibility: 'public',
      sourceFolder: '/proj',
      push: true,
    });
    expect(result).toEqual({ nameWithOwner: 'acme/widgets', url: 'https://github.com/acme/widgets' });
    expect(calls[0]?.[1]).toBe('view');
    expect(calls[1]?.[1]).toBe('create');
  });

  it('never calls repo create and throws RepositoryAlreadyExistsError when the name is taken', async () => {
    const calls: string[][] = [];
    const executor: GhExecutor = async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: JSON.stringify(REPO_VIEW_FIXTURE), stderr: '' };
    };
    await expect(
      createAndPublishRepository(executor, { owner: 'acme', name: 'widgets', visibility: 'public', sourceFolder: '/proj', push: true }),
    ).rejects.toThrow(RepositoryAlreadyExistsError);
    expect(calls.some((call) => call[1] === 'create')).toBe(false);
  });
});
