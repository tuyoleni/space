/**
 * AI comment review: real, on-demand Gemini API calls (Google Gen AI SDK) —
 * one request per TODO/FIXME comment found in the project, asking for a
 * proposed one-line fix. Nothing here is autonomous: `reviewComments` only
 * reads files and returns proposals, and `applyFix` only writes the one
 * line the renderer already showed the user and got confirmation for — the
 * model never edits a file on its own initiative. The API key is never held
 * in plain text at rest: `setApiKey` encrypts it with Electron's OS-backed
 * `safeStorage` (Keychain on macOS, DPAPI on Windows) before writing it to
 * disk.
 *
 * This is the only module in the app that sends content to a remote model,
 * so ADR-008's non-negotiable floor is enforced *here*, at the point of
 * egress, in the same three overlapping layers the ADR specifies:
 *
 *  1. Whole-file exclusion by path (`isEligibleForModel` -> `isSensitivePath`):
 *     `.env*`, SSH keys, `*.pem`/`*.key`, `credentials`/`secrets`, `.npmrc`,
 *     `.netrc`, `.git-credentials` are never opened, never diffed, never
 *     sent — content-independent, so it does not rely on step 2 catching
 *     anything. Binary files are excluded on the same footing.
 *  2. Pattern redaction (`redactSecretPatterns`) over every fragment that
 *     does leave, as defence in depth — never as a replacement for step 1.
 *  3. An audit receipt per model call (spec 19.3: "logged as metadata, not
 *     raw sensitive content") recording counts and file paths only.
 *
 * Every exclusion is also reported back to the renderer, because spec 13.3
 * requires the user to know which files were sent: what was withheld is as
 * visible as what was not.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { isEligibleForModel } from '@space/agent';
import { createNodeGitExecutor, diffPatchArgs } from '@space/git-engine';
import { isSensitivePath, redactSecretPatterns } from '@space/workspace-runner';
import type {
  AiApplyFixInput,
  AiApplyFixResult,
  AiExcludedFile,
  AiGenerateCommitMessageInput,
  AiGenerateCommitMessageResult,
  AiKeyStatus,
  AiReviewCommentsInput,
  AiReviewCommentsResult,
  AiReviewFinding,
  AiSetApiKeyInput,
  Project,
} from '@space/contracts';
import { recordOperation, type StorageCaller } from './project-handlers';

/**
 * Fast, cheap Gemini model — appropriate for short review and commit-message
 * requests. Keep this pinned to a stable model: the `*-latest` alias can move
 * to a new model generation whose request parameters are incompatible with
 * the previous one (as happened when Flash-Lite moved from 2.5 to 3.x).
 */
const MODEL = 'gemini-3.5-flash-lite';
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

/** Gemini 3.x does not support disabling thought with a numeric token budget. */
const FAST_THINKING_CONFIG = { thinkingLevel: ThinkingLevel.MINIMAL } as const;

function friendlyGeminiError(error: unknown): Error {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error : new Error('Gemini request failed — try again');
  }
  if (error.status === 400) {
    return new Error('Gemini could not generate a response with the current model settings — update Space or write the message manually');
  }
  if (error.status === 401 || error.status === 403) {
    return new Error('Gemini API rejected the configured key — check it and try again');
  }
  if (error.status === 429) {
    return new Error('Gemini is rate-limiting requests — wait a moment and try again');
  }
  if (error.status >= 500) {
    return new Error('Gemini is temporarily unavailable — try again in a moment');
  }
  return new Error('Gemini request failed — try again');
}

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

async function walkForTodos(
  root: string,
  dir: string,
  out: RawFinding[],
  budget: { filesScanned: number },
  excluded: AiExcludedFile[],
): Promise<void> {
  if (out.length >= MAX_FINDINGS || budget.filesScanned >= MAX_FILES_SCANNED) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_FINDINGS || budget.filesScanned >= MAX_FILES_SCANNED) {
      return;
    }
    // Dotfiles are skipped wholesale. There is deliberately no exception for
    // `.env` here: an earlier version carved one out, which was inert only
    // because `.env` has no scannable extension — one entry in
    // SCANNABLE_EXTENSIONS away from disclosing an environment file.
    if (entry.name.startsWith('.')) {
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
      await walkForTodos(root, fullPath, out, budget, excluded);
      continue;
    }
    if (!entry.isFile() || !SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    // ADR-008 layer 1: refuse by path before the file is ever opened, so no
    // credential/key-material content exists in memory to leak downstream.
    const relativePath = path.relative(root, fullPath);
    if (isSensitivePath(relativePath.split(path.sep).join('/'))) {
      excluded.push({ filePath: relativePath, reason: 'sensitive-path' });
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
  // ADR-008 layer 2: the surrounding context is the only free-form content
  // that leaves here, so it passes through pattern redaction first. The file
  // itself already survived the path-based gate in `walkForTodos`.
  const response = await client.models.generateContent({
    model: MODEL,
    contents:
      `File: ${finding.file}\nLine ${finding.line}: ${redactSecretPatterns(finding.comment)}\n\n` +
      `Context:\n${redactSecretPatterns(finding.context)}`,
    config: {
      maxOutputTokens: 512,
      // Gemini 3.x cannot turn thinking fully off. Minimal is the supported
      // low-latency setting for this one-line lookup.
      thinkingConfig: FAST_THINKING_CONFIG,
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
    const excluded: AiExcludedFile[] = [];
    const startedAt = new Date().toISOString();
    await walkForTodos(project.canonicalPath, project.canonicalPath, raw, budget, excluded);

    const client = new GoogleGenAI({ apiKey });
    const findings: AiReviewFinding[] = [];
    let modelRequestCount = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      if (!item) {
        continue;
      }
      let proposedFix: string | null;
      try {
        modelRequestCount += 1;
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

    // ADR-008 layer 3: metadata only — counts and paths, never the prompt
    // text or the model's reply (spec 19.3).
    await recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'ai.reviewComments',
      humanSummary: `AI review: ${modelRequestCount} model request(s) over ${findings.length} comment(s)`,
      startedAt,
      state: 'succeeded',
      exitCode: 0,
      partialState: {
        modelRequestCount,
        disclosedFilePaths: [...new Set(findings.map((finding) => finding.file))],
        excludedFilePaths: excluded.map((entry) => entry.filePath),
      },
    });

    return { findings, scannedFileCount: budget.filesScanned, excluded };
  }

  async function applyFix(input: AiApplyFixInput): Promise<AiApplyFixResult> {
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const projectRoot = await fs.realpath(project.canonicalPath);
    const targetPath = path.resolve(projectRoot, input.file);
    if (!targetPath.startsWith(projectRoot + path.sep)) {
      throw new Error('Refusing to write outside the project directory');
    }
    // `path.resolve` collapses `..` but knows nothing about symlinks: a link
    // inside the project pointing outward would otherwise pass the check
    // above and be written through. Resolve the real location too.
    const realTargetPath = await fs.realpath(targetPath).catch(() => targetPath);
    if (realTargetPath !== targetPath && !realTargetPath.startsWith(projectRoot + path.sep)) {
      throw new Error('Refusing to write through a symlink that leaves the project directory');
    }
    // A fix is a write into the user's working tree, so it answers to the
    // same path policy as everything else: never edit credential/key material.
    if (isSensitivePath(input.file.split(path.sep).join('/'))) {
      throw new Error('Refusing to modify a credential or key-material file');
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

    // ADR-008 layer 1, before any diff is even requested: partition the
    // selected paths into what may leave and what may not. A withheld path
    // is never passed to `git diff`, so its content is never read, let alone
    // sent — the exclusion does not depend on redaction catching anything.
    const excluded: AiExcludedFile[] = [];
    const eligiblePaths: string[] = [];
    for (const filePath of input.filePaths) {
      const normalized = filePath.split(path.sep).join('/');
      if (!isEligibleForModel(normalized, false)) {
        excluded.push({ filePath, reason: 'sensitive-path' });
        continue;
      }
      eligiblePaths.push(filePath);
    }
    if (eligiblePaths.length === 0) {
      throw new Error(
        'Every selected file is a credential, environment, or key-material file — none of it can be sent to a model. Write this commit message yourself.',
      );
    }

    const startedAt = new Date().toISOString();
    const gitExecutor = createNodeGitExecutor();
    const cwd = project.canonicalPath;
    // `binary: false` keeps a changed binary file to git's one-line "Binary
    // files … differ" marker instead of a full literal blob (ADR-008:
    // "binary files must not be sent by default").
    const [unstaged, staged] = await Promise.all([
      gitExecutor(diffPatchArgs({ cached: false, paths: eligiblePaths, binary: false }), { cwd }),
      gitExecutor(diffPatchArgs({ cached: true, paths: eligiblePaths, binary: false }), { cwd }),
    ]);
    const rawDiffText = `${staged.stdout}${unstaged.stdout}`.trim();
    if (!rawDiffText) {
      throw new Error('No diff found for the selected files');
    }
    // ADR-008 layer 2: defence in depth over whatever survived layer 1.
    const diffText = redactSecretPatterns(rawDiffText);
    const truncated = diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n... (truncated)` : diffText;

    const client = new GoogleGenAI({ apiKey });
    let text: string;
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: truncated,
        config: {
          maxOutputTokens: 512,
          thinkingConfig: FAST_THINKING_CONFIG,
          systemInstruction:
            'You are writing a git commit message for the given unified diff. ' +
            'Respond with ONLY the commit message: a concise imperative-mood subject line (under 72 characters), ' +
            'optionally followed by a blank line and a short body if the change genuinely needs more explanation. ' +
            'No markdown fences, no preamble, no explanation of your reasoning.',
        },
      });
      text = (response.text ?? '').trim();
    } catch (error) {
      await recordOperation(storage, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'ai.generateCommitMessage',
        humanSummary: 'AI commit message request failed',
        startedAt,
        state: 'failed',
        exitCode: 1,
        partialState: { disclosedFilePaths: eligiblePaths, excludedFilePaths: excluded.map((e) => e.filePath) },
      });
      throw friendlyGeminiError(error);
    }
    if (!text) {
      throw new Error('Gemini returned an empty commit message — try again');
    }

    // ADR-008 layer 3: metadata only (spec 19.3) — which paths were
    // disclosed and which were withheld, never the diff or the reply.
    await recordOperation(storage, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      type: 'ai.generateCommitMessage',
      humanSummary: `AI commit message from ${eligiblePaths.length} file(s)`,
      startedAt,
      state: 'succeeded',
      exitCode: 0,
      partialState: { disclosedFilePaths: eligiblePaths, excludedFilePaths: excluded.map((e) => e.filePath) },
    });

    return { message: text, excluded };
  }

  return { keyStatus, setApiKey, reviewComments, applyFix, generateCommitMessage };
}
