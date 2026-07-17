/**
 * Derives an `ActivityEvent` from an already-completed `Operation` (spec
 * 17.1 ACT-001: "records real events from operations"). This is the single
 * mapping table between the generic Operation/receipt ledger every
 * mutating command already writes (spec section 33) and the activity
 * taxonomy — every workspace/project/dev-server flow that already goes
 * through `withReceipt`/`operation.recordCompleted` picks up an activity
 * event for free, with no per-call-site wiring required, by having the
 * storage layer call this after every completed operation.
 *
 * Only successful operations become activity: a failed attempt at
 * meaningful work is not itself meaningful activity (spec 17.2: "avoid
 * equating raw keystrokes... with meaningful productivity" — the same
 * principle extends to failed no-op attempts).
 */
import type { ActivityEventType, NewActivityEvent } from './types';

export interface OperationLike {
  readonly type: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly humanSummary: string;
  readonly endedAt: string | null;
  readonly state: string;
  readonly subjectRef?: string | null;
}

interface Mapping {
  readonly eventType: ActivityEventType;
  readonly weight: number;
}

/**
 * Operation `type` strings are the same ones project-handlers.ts and
 * git-handlers.ts already pass to `recordOperation`/`operation.
 * recordCompleted` — this table is the one place that has to stay in sync
 * with those string literals.
 */
const OPERATION_TYPE_TO_ACTIVITY: Readonly<Record<string, Mapping>> = {
  'workspace.create': { eventType: 'workspace-created', weight: 1 },
  'workspace.activate': { eventType: 'workspace-switched', weight: 0.5 },
  'project.add': { eventType: 'project-added', weight: 1 },
  'project.createFromTemplate': { eventType: 'project-created', weight: 2 },
  'project.clone': { eventType: 'project-cloned', weight: 2 },
  'project.installDependencies': { eventType: 'tool-verified', weight: 1 },
  'project.devServer.start': { eventType: 'dev-server-started', weight: 1 },
  'project.devServer.stop': { eventType: 'dev-server-stopped', weight: 0.5 },
  'git.init': { eventType: 'git-initialised', weight: 2 },
  'git.commit': { eventType: 'commit', weight: 3 },
  'git.branch.create': { eventType: 'branch-created', weight: 1 },
  'git.branch.switch': { eventType: 'branch-switched', weight: 1 },
  'git.branch.delete': { eventType: 'branch-deleted', weight: 1 },
  'git.branch.merge': { eventType: 'branch-merged', weight: 2 },
  'git.fetch': { eventType: 'fetch', weight: 1 },
  'git.pull': { eventType: 'pull', weight: 2 },
  'git.push': { eventType: 'push', weight: 2 },
  'automation.run': { eventType: 'automation-execution', weight: 1 },
};

/** Returns null for operation types that are not activity-worthy (unmapped) or that did not succeed. */
export function activityEventFromOperation(operation: OperationLike): NewActivityEvent | null {
  if (operation.state !== 'succeeded' || operation.workspaceId === null || operation.endedAt === null) {
    return null;
  }
  const mapping = OPERATION_TYPE_TO_ACTIVITY[operation.type];
  if (!mapping) {
    return null;
  }
  return {
    workspaceId: operation.workspaceId,
    projectId: operation.projectId,
    eventType: mapping.eventType,
    occurredAt: operation.endedAt,
    subjectRef: operation.subjectRef ?? null,
    summary: operation.humanSummary,
    weight: mapping.weight,
    metadata: null,
  };
}
