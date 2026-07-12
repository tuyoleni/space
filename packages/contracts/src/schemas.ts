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
