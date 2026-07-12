/**
 * Activity event model (spec section 17, ACT-001; entity shape spec 23.2.9
 * ActivityEvent). Every event recorded here must trace back to a real
 * completed operation or an observed repository state change — this
 * package never generates activity for demo/empty-state purposes.
 */

/**
 * The event categories spec 17.1 lists. Not every category has a producer
 * wired up in M5 (GitHub/PR/workflow/release/automation events land in
 * later milestones once those features exist) — the type stays exhaustive
 * so later milestones extend it rather than inventing a parallel taxonomy.
 */
export type ActivityEventType =
  | 'workspace-created'
  | 'workspace-switched'
  | 'project-added'
  | 'project-created'
  | 'project-cloned'
  | 'project-removed'
  | 'tool-installed'
  | 'tool-verified'
  | 'terminal-session'
  | 'dev-server-started'
  | 'dev-server-stopped'
  | 'git-initialised'
  | 'commit'
  | 'branch-created'
  | 'branch-switched'
  | 'branch-deleted'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'pull-request'
  | 'check-or-workflow'
  | 'release-or-deployment'
  | 'automation-execution';

export interface ActivityEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly eventType: ActivityEventType;
  readonly occurredAt: string;
  /** e.g. a commit SHA, branch name, or PR number — spec 17.3's "links to the relevant commit, PR, ...". */
  readonly subjectRef: string | null;
  readonly summary: string;
  /**
   * Meaningful-activity weight, not a raw event count (spec 17.2: "avoid
   * equating raw keystrokes or file saves with meaningful productivity").
   * A commit weighs more than a branch switch; the grid sums weight per
   * day, not just count.
   */
  readonly weight: number;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface NewActivityEvent {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly eventType: ActivityEventType;
  readonly occurredAt: string;
  readonly subjectRef: string | null;
  readonly summary: string;
  readonly weight: number;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}
