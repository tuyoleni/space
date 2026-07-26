/**
 * The MCP tool catalog: the surface Space exposes to external AI tools
 * (Claude Code, Cursor, Claude Desktop, …) over the local MCP server.
 *
 * Follows the agent-handlers.ts blueprint — compose the already-built
 * M4–M6 handler objects, treat every input as untrusted and parse it
 * through the shared @space/contracts zod schemas before dispatch
 * (spec 22.1: no channel accepts unvalidated input; the handlers do not
 * all self-validate, ipc.ts normally does it for them).
 *
 * V1 is deliberately read-only: every tool here observes state (projects,
 * git status/history/diffs, dev processes, activity, environment) and
 * mutates nothing, so no trust or confirmation gate applies. Mutating
 * tools must not be added casually — they need the same
 * assertTrusted/assertAgentActionConfirmed routing agent-handlers.ts uses,
 * and a threat-model update (docs/threat-model/README.md).
 */
import path from 'node:path';
import { z } from 'zod';
import {
  activityListRangeInputSchema,
  gitFileDiffInputSchema,
  gitProjectInputSchema,
  projectEnvironmentInfoInputSchema,
  type ActivityEvent,
  type DevProcessInfo,
  type Project,
  type WorkspaceSummary,
} from '@space/contracts';
import type { GitHandlers } from '../git-handlers';
import type { ProjectEnvironmentHandlers } from '../project-environment-handlers';
import type { StorageCaller } from '../project-handlers';

export interface McpToolDeps {
  readonly storage: StorageCaller;
  readonly gitHandlers: GitHandlers;
  readonly projectEnvironmentHandlers: ProjectEnvironmentHandlers;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Always a z.object — MCP requires a JSON-Schema object for tool inputs. */
  readonly inputSchema: z.ZodObject<z.ZodRawShape>;
  readonly execute: (deps: McpToolDeps, input: unknown) => Promise<unknown>;
}

/** Shared helper so every tool parses before it dispatches — dispatch never sees raw input. */
function tool<Schema extends z.ZodObject<z.ZodRawShape>>(definition: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly run: (deps: McpToolDeps, input: z.output<Schema>) => Promise<unknown>;
}): McpToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: (deps, input) => definition.run(deps, definition.inputSchema.parse(input ?? {})),
  };
}

const listProjectsInputSchema = z.object({
  workspaceId: z
    .string()
    .min(1)
    .optional()
    .describe('Limit to one workspace; omit to list projects across every workspace.'),
});

const projectIdInputSchema = z.object({
  projectId: z.string().min(1).describe('A project id from list_projects.'),
});

const gitLogInputSchema = z.object({
  projectId: z.string().min(1).describe('A project id from list_projects.'),
  offset: z.number().int().min(0).default(0).describe('Number of commits to skip (for paging).'),
  count: z.number().int().min(1).max(500).default(50).describe('Number of commits to return.'),
});

const gitFileDiffToolInputSchema = gitFileDiffInputSchema.extend({
  staged: z.boolean().default(false).describe('true for the staged (index) diff, false for the worktree diff.'),
});

const resolveProjectInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("An absolute filesystem path — normally the AI tool's own working directory."),
});

/**
 * True when `candidate` is `parent` itself or something inside it. Compared on
 * resolved paths with an explicit separator boundary, so `/repos/app` never
 * matches a sibling `/repos/app-legacy`.
 */
function containsPath(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(resolvedParent.endsWith(path.sep) ? resolvedParent : `${resolvedParent}${path.sep}`)
  );
}

interface ResolvedProjectContext {
  readonly workspace: WorkspaceSummary;
  readonly project: Project;
  /** Which of the project's roots matched — the registered folder or its repository root. */
  readonly matchedOn: 'canonicalPath' | 'repositoryRoot';
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  tool({
    name: 'list_workspaces',
    description:
      'List every Space workspace (the top-level containers projects live in), including which one is active.',
    inputSchema: z.object({}),
    run: (deps) => deps.storage.call<WorkspaceSummary[]>('workspace.list', undefined),
  }),
  tool({
    name: 'list_projects',
    description:
      'List Space projects (name, path, repository root, trust state, detected types) — across all workspaces by default, or scoped to one workspaceId.',
    inputSchema: listProjectsInputSchema,
    run: async (deps, input) => {
      if (input.workspaceId) {
        return deps.storage.call<Project[]>('project.list', { workspaceId: input.workspaceId });
      }
      const workspaces = await deps.storage.call<WorkspaceSummary[]>('workspace.list', undefined);
      const perWorkspace = await Promise.all(
        workspaces.map((workspace) => deps.storage.call<Project[]>('project.list', { workspaceId: workspace.id })),
      );
      return perWorkspace.flat();
    },
  }),
  tool({
    name: 'resolve_project',
    description:
      "Map a filesystem path (normally your own working directory) to the Space workspace and project that owns it — call this first so the rest of these tools, and any work you do on disk, are scoped to the right workspace instead of a bare folder. Returns null when the path isn't inside any registered project. When Space launched you, the same context is also in the SPACE_WORKSPACE_ID / SPACE_PROJECT_ID environment variables.",
    inputSchema: resolveProjectInputSchema,
    run: async (deps, input) => {
      const workspaces = await deps.storage.call<WorkspaceSummary[]>('workspace.list', undefined);
      const candidates: ResolvedProjectContext[] = [];
      for (const workspace of workspaces) {
        const projects = await deps.storage.call<Project[]>('project.list', { workspaceId: workspace.id });
        for (const project of projects) {
          if (containsPath(project.canonicalPath, input.path)) {
            candidates.push({ workspace, project, matchedOn: 'canonicalPath' });
          } else if (project.repositoryRoot && containsPath(project.repositoryRoot, input.path)) {
            candidates.push({ workspace, project, matchedOn: 'repositoryRoot' });
          }
        }
      }
      // Nested registrations are legal (a monorepo folder and a package inside
      // it), so the deepest matching root is the answer, not the first found.
      return (
        candidates.sort(
          (a, b) =>
            (b.matchedOn === 'canonicalPath' ? b.project.canonicalPath : (b.project.repositoryRoot ?? '')).length -
            (a.matchedOn === 'canonicalPath' ? a.project.canonicalPath : (a.project.repositoryRoot ?? '')).length,
        )[0] ?? null
      );
    },
  }),
  tool({
    name: 'get_project',
    description: 'Fetch one Space project by id, including its canonical path, repository root, and trust state.',
    inputSchema: projectIdInputSchema,
    run: (deps, input) => deps.storage.call<Project>('project.get', { projectId: input.projectId }),
  }),
  tool({
    name: 'git_status',
    description:
      "Authoritative git status for a project's repository: current branch, staged/unstaged/untracked entries, conflicts, and any in-progress operation (merge/rebase/…).",
    inputSchema: gitProjectInputSchema,
    run: (deps, input) => deps.gitHandlers.status(input),
  }),
  tool({
    name: 'git_branches',
    description: 'List local and remote-tracking branches for a project, including the current branch and upstreams.',
    inputSchema: gitProjectInputSchema,
    run: (deps, input) => deps.gitHandlers.listBranches(input),
  }),
  tool({
    name: 'git_log',
    description: 'Commit history for a project (cached, paginated): sha, author, date, subject, parents.',
    inputSchema: gitLogInputSchema,
    run: (deps, input) =>
      deps.gitHandlers.loadHistory({ projectId: input.projectId, offset: input.offset, count: input.count }),
  }),
  tool({
    name: 'git_diff_stats',
    description: 'Per-file added/removed line counts for the working tree and index of a project.',
    inputSchema: gitProjectInputSchema,
    run: (deps, input) => deps.gitHandlers.diffStats(input),
  }),
  tool({
    name: 'git_file_diff',
    description: 'The unified diff of one file in a project, either staged (index) or unstaged (worktree).',
    inputSchema: gitFileDiffToolInputSchema,
    run: (deps, input) => deps.gitHandlers.diffFile(input),
  }),
  tool({
    name: 'git_remotes',
    description: 'List the git remotes (name and URL) configured for a project.',
    inputSchema: gitProjectInputSchema,
    run: (deps, input) => deps.gitHandlers.listRemotes(input),
  }),
  tool({
    name: 'list_dev_processes',
    description:
      'List the dev-server processes Space has started for a project (command, pid, state, detected local URL).',
    inputSchema: projectIdInputSchema,
    run: (deps, input) => deps.storage.call<DevProcessInfo[]>('devProcess.list', { projectId: input.projectId }),
  }),
  tool({
    name: 'get_project_environment',
    description:
      "A project's runtime environment: package manager, lockfile, scripts, runtimes, and declared env-var names (never values).",
    inputSchema: projectEnvironmentInfoInputSchema,
    run: (deps, input) => deps.projectEnvironmentHandlers.environmentInfo(input),
  }),
  tool({
    name: 'list_activity',
    description:
      'The workspace activity feed (commits, pushes, installs, agent actions, …) between two ISO-8601 timestamps.',
    inputSchema: activityListRangeInputSchema,
    run: (deps, input) => deps.storage.call<ActivityEvent[]>('activity.listRange', input),
  }),
];

export function findMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((candidate) => candidate.name === name);
}

export async function runMcpTool(deps: McpToolDeps, name: string, input: unknown): Promise<unknown> {
  const definition = findMcpTool(name);
  if (!definition) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return definition.execute(deps, input);
}
