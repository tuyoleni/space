import { z } from 'zod';

/**
 * Runtime validation for every IPC input (spec sections 20.1, 22.1: "every
 * request... plus runtime validation", "no channel accepts arbitrary...
 * without domain validation"). Main-process handlers must parse the raw
 * IPC payload through these before touching storage or the filesystem.
 */
export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  iconToken: z.string().min(1).max(100).optional(),
  defaultProjectDirectory: z.string().min(1).optional(),
});

export const workspaceActivateInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const inspectFolderInputSchema = z.object({
  path: z.string().min(1),
});

export const projectListInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const addProjectInputSchema = z.object({
  workspaceId: z.string().min(1),
  canonicalPath: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// M4
// ---------------------------------------------------------------------------

export const detectProjectInputSchema = z.object({
  canonicalPath: z.string().min(1),
});

export const detectPackageManagerInputSchema = z.object({
  canonicalPath: z.string().min(1),
});

const jsPackageManagerIdSchema = z.enum(['npm', 'yarn', 'pnpm']);

export const installDependenciesInputSchema = z.object({
  projectId: z.string().min(1),
  packageManager: jsPackageManagerIdSchema.optional(),
  allowOnce: z.boolean().optional(),
});

const trustDecisionSchema = z.enum(['allow-once', 'trust-this-project', 'keep-untrusted']);

export const projectTrustDecisionInputSchema = z.object({
  projectId: z.string().min(1),
  decision: trustDecisionSchema,
});

const projectTemplateOptionValueSchema = z.union([z.string(), z.boolean()]);

export const createProjectFromTemplateInputSchema = z.object({
  workspaceId: z.string().min(1),
  templateId: z.string().min(1),
  destinationParentDirectory: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // Directory-name safety: no path separators or leading dot-dot traversal.
    .regex(/^[^/\\]+$/, 'name must not contain a path separator')
    .refine((value) => value !== '.' && value !== '..', 'name must not be "." or ".."'),
  options: z.record(z.string(), projectTemplateOptionValueSchema).optional(),
});

export const cloneProjectInputSchema = z.object({
  workspaceId: z.string().min(1),
  remoteUrl: z.string().min(1).refine((value) => !value.startsWith('-'), 'remote must not look like a flag'),
  destinationParentDirectory: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^/\\]+$/, 'name must not contain a path separator')
    .optional(),
  branch: z.string().trim().min(1).max(250).optional(),
});

export const createTerminalInputSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  cols: z.number().int().min(1).max(2000),
  rows: z.number().int().min(1).max(2000),
});

export const terminalWriteInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string(),
});

export const terminalResizeInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(1).max(2000),
  rows: z.number().int().min(1).max(2000),
});

export const terminalDisposeInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const startDevServerInputSchema = z.object({
  projectId: z.string().min(1),
  allowOnce: z.boolean().optional(),
});

export const stopDevServerInputSchema = z.object({
  devProcessId: z.string().min(1),
});
