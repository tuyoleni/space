import fs from 'node:fs/promises';
import path from 'node:path';
import type { AiToolId } from '@space/contracts';

const START_MARKER = '<!-- space:mcp-context:start -->';
const END_MARKER = '<!-- space:mcp-context:end -->';

const INSTRUCTION = `${START_MARKER}
Space workspace context: At the start of every coding session, call the Space MCP tool \`get_project_context\` with the absolute current working-directory path. If the working directory or codebase changes, call it again before using any other Space tool. Use only the workspace and project ID returned for that path; never reuse a project ID from another codebase.
${END_MARKER}`;

const CURSOR_FRONTMATTER = `---
description: Route this project through its Space workspace
alwaysApply: true
---`;

export interface ProjectInstructionResult {
  readonly tool: AiToolId;
  readonly filePath: string;
  readonly created: boolean;
  readonly changed: boolean;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function instructionPath(projectPath: string, tool: AiToolId): Promise<string> {
  switch (tool) {
    case 'claude-code': {
      const rootFile = path.join(projectPath, 'CLAUDE.md');
      if (await exists(rootFile)) return rootFile;
      const nestedFile = path.join(projectPath, '.claude', 'CLAUDE.md');
      return await exists(nestedFile) ? nestedFile : rootFile;
    }
    case 'codex': return path.join(projectPath, 'AGENTS.md');
    case 'cursor': return path.join(projectPath, '.cursor', 'rules', 'space.mdc');
    case 'vscode': return path.join(projectPath, '.github', 'copilot-instructions.md');
  }
}

function managedBlock(tool: AiToolId): string {
  return tool === 'cursor' ? `${CURSOR_FRONTMATTER}\n\n${INSTRUCTION}` : INSTRUCTION;
}

function mergeInstruction(existing: string, tool: AiToolId): string {
  const start = existing.indexOf(START_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (start >= 0 && end >= start) {
    const contentEnd = end + END_MARKER.length;
    return `${existing.slice(0, start)}${INSTRUCTION}${existing.slice(contentEnd)}`;
  }
  const block = managedBlock(tool);
  if (!existing.trim()) return `${block}\n`;
  return `${block}\n\n${existing.replace(/^\s+/, '')}`;
}

export async function ensureProjectInstruction(
  projectPath: string,
  tool: AiToolId,
): Promise<ProjectInstructionResult> {
  const filePath = await instructionPath(projectPath, tool);
  const previous = await fs.readFile(filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const next = mergeInstruction(previous ?? '', tool);
  const changed = next !== previous;
  if (changed) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, next, 'utf8');
  }
  return { tool, filePath, created: previous === null, changed };
}

export async function ensureAllProjectInstructions(projectPath: string): Promise<readonly ProjectInstructionResult[]> {
  return Promise.all((['claude-code', 'codex', 'cursor', 'vscode'] as const)
    .map((tool) => ensureProjectInstruction(projectPath, tool)));
}
