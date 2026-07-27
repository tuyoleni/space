import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAllProjectInstructions, ensureProjectInstruction } from './project-instructions';

const temporaryDirectories: string[] = [];

async function projectDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-project-instructions-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Space project instructions', () => {
  it('creates instruction files for every supported developer tool', async () => {
    const root = await projectDirectory();
    await ensureAllProjectInstructions(root);

    await expect(fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')).resolves.toContain('get_project_context');
    await expect(fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).resolves.toContain('get_project_context');
    await expect(fs.readFile(path.join(root, '.cursor/rules/space.mdc'), 'utf8')).resolves.toContain('alwaysApply: true');
    await expect(fs.readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8')).resolves.toContain('get_project_context');
  });

  it('prepends the managed block without replacing existing instructions', async () => {
    const root = await projectDirectory();
    await fs.writeFile(path.join(root, 'CLAUDE.md'), '# Existing project guidance\n\nKeep this.\n');

    await ensureProjectInstruction(root, 'claude-code');
    const contents = await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8');

    expect(contents.indexOf('get_project_context')).toBeLessThan(contents.indexOf('# Existing project guidance'));
    expect(contents).toContain('Keep this.');
  });

  it('uses an existing .claude/CLAUDE.md and stays idempotent', async () => {
    const root = await projectDirectory();
    const nested = path.join(root, '.claude', 'CLAUDE.md');
    await fs.mkdir(path.dirname(nested), { recursive: true });
    await fs.writeFile(nested, 'Nested guidance.\n');

    await ensureProjectInstruction(root, 'claude-code');
    await ensureProjectInstruction(root, 'claude-code');
    const contents = await fs.readFile(nested, 'utf8');

    expect(contents.match(/space:mcp-context:start/g)).toHaveLength(1);
    await expect(fs.access(path.join(root, 'CLAUDE.md'))).rejects.toThrow();
  });
});
