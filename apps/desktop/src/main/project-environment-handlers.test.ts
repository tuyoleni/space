import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@space/contracts';
import type { StorageCaller } from './project-handlers';
import { createProjectEnvironmentHandlers } from './project-environment-handlers';

const temporaryDirectories: string[] = [];

async function setup() {
  const canonicalPath = await fs.mkdtemp(path.join(os.tmpdir(), 'space-project-env-'));
  temporaryDirectories.push(canonicalPath);
  const project = { id: 'project-1', workspaceId: 'workspace-1', canonicalPath } as Project;
  const storage = { call: async () => project } as unknown as StorageCaller;
  const opened: string[] = [];
  return {
    canonicalPath,
    opened,
    handlers: createProjectEnvironmentHandlers(storage, { openTextFile: async (filePath) => { opened.push(filePath); } }),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('project environment actions', () => {
  it('pins a valid Node version in .nvmrc and reports it on refresh', async () => {
    const { canonicalPath, handlers } = await setup();

    await expect(handlers.setRuntime({ projectId: 'project-1', version: 'v24.4.1' }))
      .resolves.toEqual({ filePath: path.join(canonicalPath, '.nvmrc') });
    await expect(fs.readFile(path.join(canonicalPath, '.nvmrc'), 'utf8')).resolves.toBe('24.4.1\n');
    await expect(handlers.environmentInfo({ projectId: 'project-1' })).resolves.toMatchObject({
      runtimeVersion: '24.4.1',
      runtimeSource: 'via .nvmrc',
    });
  });

  it('creates a private .env and opens it with the configured text editor', async () => {
    const { canonicalPath, handlers, opened } = await setup();

    await expect(handlers.openEnvFile({ projectId: 'project-1' })).resolves.toEqual({ filePath: path.join(canonicalPath, '.env') });
    expect(opened).toEqual([path.join(canonicalPath, '.env')]);
    expect((await fs.stat(path.join(canonicalPath, '.env'))).mode & 0o777).toBe(0o600);
  });
});
