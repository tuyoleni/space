import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@space/contracts';
import type { EnvironmentHandlers } from './environment-handlers';
import type { GitHandlers } from './git-handlers';
import type { GithubHandlers } from './github-handlers';
import type { StorageCaller } from './project-handlers';
import { createProjectReadinessHandlers } from './project-readiness-handlers';

const project: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'Demo',
  canonicalPath: '/projects/demo',
  filesystemIdentity: null,
  repositoryRoot: '/projects/demo',
  trustState: 'trusted',
  detectedTypes: [],
  lastOpenedAt: null,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

function setup(options: { commitError?: Error } = {}) {
  const storage = {
    call: vi.fn(async (method: string) => {
      if (method === 'project.get') return project;
      throw new Error(`Unexpected storage call: ${method}`);
    }),
  } as unknown as StorageCaller;

  const gitHandlers = {
    initRepo: vi.fn(),
    stage: vi.fn(),
    commit: options.commitError ? vi.fn().mockRejectedValue(options.commitError) : vi.fn().mockResolvedValue({ sha: 'abc123' }),
    status: vi.fn().mockResolvedValue({ branch: { detached: false, branchName: 'main', upstream: null } }),
    listRemotes: vi.fn().mockResolvedValue([]),
    loadHistory: vi.fn().mockResolvedValue({ commits: [{ sha: 'abc123' }] }),
  } as unknown as GitHandlers;

  const githubHandlers = {
    authReport: vi.fn().mockResolvedValue({ cliInstalled: true, authenticated: true, activeAccount: { account: 'demo' } }),
  } as unknown as GithubHandlers;

  const handlers = createProjectReadinessHandlers(storage, {
    gitHandlers,
    githubHandlers,
    environmentHandlers: {} as EnvironmentHandlers,
  });

  return { handlers, gitHandlers };
}

describe('create-initial-commit remedy', () => {
  it('stages and commits an existing zero-commit repository instead of calling the no-op initializer', async () => {
    const { handlers, gitHandlers } = setup();

    const result = await handlers.applyRemedy({ projectId: project.id, remedyId: 'create-initial-commit' });

    expect(gitHandlers.initRepo).not.toHaveBeenCalled();
    expect(gitHandlers.stage).toHaveBeenCalledWith({ projectId: project.id, paths: ['.'] });
    expect(gitHandlers.commit).toHaveBeenCalledWith({ projectId: project.id, message: 'Initial commit' });
    expect(result.message).toBe('Saved the first snapshot.');
    expect(result.diagnosis.issues.some((issue) => issue.id === 'no-commits')).toBe(false);
  });

  it('surfaces commit failures instead of reporting that a snapshot was saved', async () => {
    const { handlers } = setup({ commitError: new Error('Git author identity is missing') });

    await expect(
      handlers.applyRemedy({ projectId: project.id, remedyId: 'create-initial-commit' }),
    ).rejects.toThrow('Git author identity is missing');
  });
});
