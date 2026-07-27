/**
 * ADR-008's non-negotiable floor, asserted at the one place in the app that
 * actually sends content to a remote model. These tests care about exactly
 * one question: does anything that must never leave the machine reach the
 * model client?
 *
 * The Gemini client is faked so the "request" is observable without a
 * network call or an API key; every prompt it receives is captured and
 * asserted against. `safeStorage` is faked to a reversible encoding — the
 * real one needs a logged-in OS keychain session that CI does not have.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@space/contracts';

/** Every prompt handed to the model, in order — the egress under test. */
const sentPrompts: string[] = [];
const sentRequests: Array<{ model: string; config?: Record<string, unknown> }> = [];

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8'),
  },
}));

vi.mock('@google/genai', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  ThinkingLevel: { MINIMAL: 'MINIMAL' },
  GoogleGenAI: class {
    models = {
      generateContent: async ({ contents, model, config }: { contents: string; model: string; config?: Record<string, unknown> }) => {
        sentPrompts.push(contents);
        sentRequests.push({ model, ...(config !== undefined ? { config } : {}) });
        return { text: 'chore: update things' };
      },
    };
  },
}));

import { createAiHandlers } from './ai-handlers';

let tmpDir: string;
let keyFilePath: string;

function projectAt(canonicalPath: string): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'demo',
    canonicalPath,
    filesystemIdentity: null,
    repositoryRoot: canonicalPath,
    trustState: 'trusted',
    detectedTypes: [],
    lastOpenedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Records receipts so the audit assertions can read them back. */
function makeStorage(project: Project) {
  const receipts: { type: string; partialState: unknown }[] = [];
  const call = (async (method: string, payload: unknown) => {
    if (method === 'project.get') {
      return project;
    }
    if (method === 'operation.recordCompleted') {
      const input = payload as { type: string; partialState: unknown };
      receipts.push({ type: input.type, partialState: input.partialState });
      return undefined;
    }
    throw new Error(`unexpected storage call: ${method}`);
  }) as never;
  return { storage: { call } as never, receipts };
}

beforeEach(async () => {
  sentPrompts.length = 0;
  sentRequests.length = 0;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-ai-privacy-'));
  keyFilePath = path.join(tmpDir, 'ai-credentials.enc');
  await fs.writeFile(keyFilePath, Buffer.from('fake-api-key', 'utf8'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ADR-008: what may leave the machine (reviewComments)', () => {
  it('never opens or sends a credential/env/key-material file, and reports it as excluded', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(path.join(projectDir, 'config'), { recursive: true });
    // Sensitive by path, and carrying a TODO in a scannable extension so
    // that only the path gate can keep it out.
    await fs.writeFile(path.join(projectDir, 'config', 'secrets.ts'), '// TODO: rotate this\nconst k = "AKIAIOSFODNN7EXAMPLE";\n');
    await fs.writeFile(path.join(projectDir, 'credentials.ts'), '// TODO: move to keychain\n');
    await fs.writeFile(path.join(projectDir, 'app.ts'), '// TODO: handle the empty case\nexport const a = 1;\n');

    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    const result = await handlers.reviewComments({ projectId: project.id });

    const excludedPaths = result.excluded.map((entry) => entry.filePath.split(path.sep).join('/'));
    expect(excludedPaths).toContain('config/secrets.ts');
    expect(excludedPaths).toContain('credentials.ts');
    expect(result.excluded.every((entry) => entry.reason === 'sensitive-path')).toBe(true);

    // The eligible file was reviewed...
    expect(result.findings.map((f) => f.file)).toEqual(['app.ts']);
    // ...and nothing from the excluded files reached the model.
    const everythingSent = sentPrompts.join('\n');
    expect(everythingSent).toContain('handle the empty case');
    expect(everythingSent).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(everythingSent).not.toContain('rotate this');
    expect(everythingSent).not.toContain('move to keychain');
  });

  it('redacts secret shapes in the context that does get sent', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'app.ts'),
      ['const token = "ghp_012345678901234567890123456789012345";', '// TODO: read this from the environment', 'export const a = 1;'].join('\n'),
    );

    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await handlers.reviewComments({ projectId: project.id });

    expect(sentPrompts.join('\n')).not.toContain('ghp_012345678901234567890123456789012345');
    expect(sentPrompts.join('\n')).toContain('[REDACTED]');
  });

  it('records an audit receipt carrying metadata only — never prompt or reply text', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, 'app.ts'), '// TODO: something\n');
    await fs.writeFile(path.join(projectDir, '.npmrc'), '//registry.npmjs.org/:_authToken=secret\n');

    const project = projectAt(projectDir);
    const { storage, receipts } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await handlers.reviewComments({ projectId: project.id });

    const receipt = receipts.find((entry) => entry.type === 'ai.reviewComments');
    expect(receipt).toBeDefined();
    const serialized = JSON.stringify(receipt?.partialState);
    expect(serialized).toContain('app.ts');
    expect(serialized).not.toContain('chore: update things');
    expect(serialized).not.toContain('_authToken');
  });
});

describe('ADR-008: applyFix write boundary', () => {
  it('refuses to write outside the project directory', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await expect(
      handlers.applyFix({ projectId: project.id, file: '../escaped.ts', line: 1, originalLine: 'a', newLine: 'b' }),
    ).rejects.toThrow(/outside the project directory/);
  });

  it('refuses to modify credential or key-material files', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, '.env'), 'API_KEY=live\n');
    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await expect(
      handlers.applyFix({ projectId: project.id, file: '.env', line: 1, originalLine: 'API_KEY=live', newLine: 'API_KEY=x' }),
    ).rejects.toThrow(/credential or key-material/);

    // The file is untouched.
    expect(await fs.readFile(path.join(projectDir, '.env'), 'utf-8')).toBe('API_KEY=live\n');
  });
});

describe('ADR-008: generateCommitMessage path partitioning', () => {
  it('refuses outright when every selected file is sensitive, without calling the model', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await expect(
      handlers.generateCommitMessage({ projectId: project.id, filePaths: ['.env', 'deploy/id_rsa', 'certs/server.pem'] }),
    ).rejects.toThrow(/credential, environment, or key-material/);

    expect(sentPrompts).toHaveLength(0);
  });

  it('uses a stable Gemini 3 model with its supported thinking-level configuration', async () => {
    const projectDir = path.join(tmpDir, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: projectDir });
    await fs.writeFile(path.join(projectDir, 'app.ts'), 'export const answer = 42;\n');
    execFileSync('git', ['add', 'app.ts'], { cwd: projectDir });

    const project = projectAt(projectDir);
    const { storage } = makeStorage(project);
    const handlers = createAiHandlers(storage, { keyFilePath });

    await expect(
      handlers.generateCommitMessage({ projectId: project.id, filePaths: ['app.ts'] }),
    ).resolves.toEqual({ message: 'chore: update things', excluded: [] });

    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0]?.model).toBe('gemini-3.5-flash-lite');
    expect(sentRequests[0]?.config).toMatchObject({
      maxOutputTokens: 512,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    });
    expect(sentRequests[0]?.config).not.toMatchObject({
      thinkingConfig: { thinkingBudget: expect.anything() },
    });
  });
});
