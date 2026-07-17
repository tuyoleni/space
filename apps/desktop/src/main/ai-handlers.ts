/**
 * AI comment review: real, on-demand Gemini API calls (Google Gen AI SDK) —
 * one request per TODO/FIXME comment found in the project, asking for a
 * proposed one-line fix. Nothing here is autonomous: `reviewComments` only
 * reads files and returns proposals, and `applyFix` only writes the one
 * line the renderer already showed the user and got confirmation for
 * (mirrors agent-handlers.ts's `confirmed`-gated dispatch — the model never
 * edits a file on its own initiative). The API key is never held in plain
 * text at rest: `setApiKey` encrypts it with Electron's OS-backed
 * `safeStorage` (Keychain on macOS, DPAPI on Windows) before writing it to
 * disk.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { ApiError, GoogleGenAI } from '@google/genai';
import { createNodeGitExecutor, diffPatchArgs } from '@space/git-engine';
import type {
  AiApplyFixInput,
  AiApplyFixResult,
  AiGenerateCommitMessageInput,
  AiGenerateCommitMessageResult,
  AiKeyStatus,
  AiReviewCommentsInput,
  AiReviewCommentsResult,
  AiReviewFinding,
  AiSetApiKeyInput,
  Project,
} from '@space/contracts';
import type { StorageCaller } from './project-handlers';

/**
 * Fast, cheap Gemini model — appropriate for a short per-comment review call, not a long
 * reasoning task. `gemini-flash-latest` is prone to real, repeated 503 "high demand"
 * responses from Google's side; `gemini-flash-lite-latest` is the lighter-weight sibling
 * in the same alias family and has proven reliable in practice.
 */
const MODEL = 'gemini-flash-lite-latest';
const MAX_FINDINGS = 15;
const MAX_FILES_SCANNED = 2000;
const CONTEXT_LINES = 5;

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.sh',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.cache', 'target', 'vendor',
]);

const TODO_PATTERN = /^(\s*)(?:\/\/|#)\s*(TODO|FIXME)[:\s](.*)$/;

export interface AiHandlersOptions {
  readonly keyFilePath: string;
}

export interface AiHandlers {
  keyStatus(): Promise<AiKeyStatus>;
  setApiKey(input: AiSetApiKeyInput): Promise<void>;
  reviewComments(input: AiReviewCommentsInput): Promise<AiReviewCommentsResult>;
  applyFix(input: AiApplyFixInput): Promise<AiApplyFixResult>;
  generateCommitMessage(input: AiGenerateCommitMessageInput): Promise<AiGenerateCommitMessageResult>;
}

/** Diff text past this length is truncated before being sent to the model — plenty for a commit message, cheap to send. */
const MAX_DIFF_CHARS = 12000;

interface RawFinding {
  readonly file: string;
  readonly line: number;
  readonly comment: string;
  readonly originalLine: string;
  readonly context: string;
}

async function readStoredKey(keyFilePath: string): Promise<string | null> {
  try {
    const encrypted = await fs.readFile(keyFilePath);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

async function walkForTodos(root: string, dir: string, out: RawFinding[], budget: { filesScanned: number }): Promise<void> {
  if (out.length >= MAX_FINDINGS || budget.filesScanned >= MAX_FILES_SCANNED) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_FINDINGS || budget.filesScanned >= MAX_FILES_SCANNED) {
      return;
    }
    if (entry.name.startsWith('.') && entry.name !== '.env') {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        // Allow non-dotfile-convention dirs through, but most dotdirs (.git, .cache, ...) are noise.
      } else {
        continue;
      }
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      await walkForTodos(root, fullPath, out, budget);
      continue;
    }
    if (!entry.isFile() || !SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    budget.filesScanned += 1;
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => null);
    if (content === null) {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (out.length >= MAX_FINDINGS) {
        break;
      }
      const match = TODO_PATTERN.exec(lines[i] ?? '');
      if (!match) {
        continue;
      }
      const start = Math.max(0, i - CONTEXT_LINES);
      const end = Math.min(lines.length, i + CONTEXT_LINES + 1);
      out.push({
        file: path.relative(root, fullPath),
        line: i + 1,
        comment: (lines[i] ?? '').trim(),
        originalLine: lines[i] ?? '',
        context: lines.slice(start, end).join('\n'),
      });
    }
  }
}

/** Asks Gemini for a single-line fix; returns null when it can't confidently propose one-line replacement. */
async function proposeFix(client: GoogleGenAI, finding: RawFinding): Promise<string | null> {
  const response = await client.models.generateContent({
    model: MODEL,
    contents: `File: ${finding.file}\nLine ${finding.line}: ${finding.comment}\n\nContext:\n${finding.context}`,
    config: {
      maxOutputTokens: 300,
      // This model line thinks by default, and thinking tokens count against
      // maxOutputTokens — left on, a short budget here gets consumed almost
      // entirely by thinking and the real answer comes back truncated
      // (verified empirically). This is a one-line lookup, not a reasoning task.
      thinkingConfig: { thinkingBudget: 0 },
      systemInstruction:
        'You are reviewing a single TODO/FIXME code comment in its surrounding file context. ' +
        'If you can propose a concrete one-line code fix that resolves the comment, respond with ONLY the replacement line ' +
        'of code — no explanation, no markdown fences, preserving the original indentation. ' +
        "If a safe one-line fix isn't possible (it needs multiple lines, more context, or a design decision), " +
        'respond with exactly: NO_FIX',
    },
  });
  const text = (response.text ?? '').trim();
  return text.length > 0 && text !== 'NO_FIX' ? text : null;
}

export function createAiHandlers(storage: StorageCaller, options: AiHandlersOptions): AiHandlers {
  async function keyStatus(): Promise<AiKeyStatus> {
    const key = await readStoredKey(options.keyFilePath);
    return { configured: key !== null && key.length > 0 };
  }

  async function setApiKey(input: AiSetApiKeyInput): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-level credential encryption is not available on this machine');
    }
    const encrypted = safeStorage.encryptString(input.apiKey);
    await fs.mkdir(path.dirname(options.keyFilePath), { recursive: true });
    await fs.writeFile(options.keyFilePath, encrypted);
  }

  async function reviewComments(input: AiReviewCommentsInput): Promise<AiReviewCommentsResult> {
    const apiKey = await readStoredKey(options.keyFilePath);
    if (!apiKey) {
      throw new Error('No Gemini API key configured — add one first');
    }
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const raw: RawFinding[] = [];
    const budget = { filesScanned: 0 };
    await walkForTodos(project.canonicalPath, project.canonicalPath, raw, budget);

    const client = new GoogleGenAI({ apiKey });
    const findings: AiReviewFinding[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      if (!item) {
        continue;
      }
      let proposedFix: string | null;
      try {
        proposedFix = await proposeFix(client, item);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          throw new Error('Gemini API rejected the configured key — check it and try again');
        }
        if (error instanceof ApiError && error.status === 429) {
          break;
        }
        proposedFix = null;
      }
      findings.push({
        id: `${item.file}:${item.line}`,
        file: item.file,
        line: item.line,
        comment: item.comment,
        originalLine: item.originalLine,
        proposedFix,
      });
    }

    return { findings, scannedFileCount: budget.filesScanned };
  }

  async function applyFix(input: AiApplyFixInput): Promise<AiApplyFixResult> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const targetPath = path.join(project.canonicalPath, input.file);
    if (!targetPath.startsWith(path.resolve(project.canonicalPath) + path.sep)) {
      throw new Error('Refusing to write outside the project directory');
    }
    const content = await fs.readFile(targetPath, 'utf-8');
    const lines = content.split('\n');
    const index = input.line - 1;
    if (lines[index] !== input.originalLine) {
      throw new Error('The file changed since this fix was proposed — re-run the review');
    }
    lines[index] = input.newLine;
    await fs.writeFile(targetPath, lines.join('\n'), 'utf-8');
    return { applied: true };
  }

  async function generateCommitMessage(input: AiGenerateCommitMessageInput): Promise<AiGenerateCommitMessageResult> {
    const apiKey = await readStoredKey(options.keyFilePath);
    if (!apiKey) {
      throw new Error('No Gemini API key configured — add one first');
    }
    if (input.filePaths.length === 0) {
      throw new Error('No files selected — include at least one change group first');
    }
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const gitExecutor = createNodeGitExecutor();
    const cwd = project.canonicalPath;
    const [unstaged, staged] = await Promise.all([
      gitExecutor(diffPatchArgs({ cached: false, paths: input.filePaths }), { cwd }),
      gitExecutor(diffPatchArgs({ cached: true, paths: input.filePaths }), { cwd }),
    ]);
    const diffText = `${staged.stdout}${unstaged.stdout}`.trim();
    if (!diffText) {
      throw new Error('No diff found for the selected files');
    }
    const truncated = diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n... (truncated)` : diffText;

    const client = new GoogleGenAI({ apiKey });
    let text: string;
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: truncated,
        config: {
          maxOutputTokens: 200,
          thinkingConfig: { thinkingBudget: 0 },
          systemInstruction:
            'You are writing a git commit message for the given unified diff. ' +
            'Respond with ONLY the commit message: a concise imperative-mood subject line (under 72 characters), ' +
            'optionally followed by a blank line and a short body if the change genuinely needs more explanation. ' +
            'No markdown fences, no preamble, no explanation of your reasoning.',
        },
      });
      text = (response.text ?? '').trim();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        throw new Error('Gemini API rejected the configured key — check it and try again');
      }
      throw error;
    }
    if (!text) {
      throw new Error('Gemini returned an empty commit message — try again');
    }
    return { message: text };
  }

  return { keyStatus, setApiKey, reviewComments, applyFix, generateCommitMessage };
}
