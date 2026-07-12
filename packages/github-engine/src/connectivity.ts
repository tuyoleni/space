/**
 * GH-009: Offline and degraded behaviour (spec 14.11). Local Git stays
 * fully available when GitHub is unreachable; cached GitHub data is
 * labelled with its last-refresh time; remote actions are disabled with
 * a clear reason. Queuing an automatic remote mutation for later is not
 * allowed — a draft can be created and reviewed, but it is never
 * auto-submitted, not even on reconnect (spec 14.11, 39).
 */

export type GithubConnectivity = 'online' | 'degraded' | 'offline';

export interface CachedGithubData<T> {
  readonly data: T;
  readonly lastRefreshedAt: string;
}

export function labelWithLastRefresh<T>(data: T, lastRefreshedAt: string): CachedGithubData<T> {
  return { data, lastRefreshedAt };
}

export interface RemoteActionAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

const UNAVAILABLE_REASON: Record<Exclude<GithubConnectivity, 'online'>, string> = {
  degraded: 'GitHub is responding slowly or partially — remote actions are paused until it recovers.',
  offline: 'GitHub is unreachable — local Git still works, but remote actions are disabled until connectivity returns.',
};

/** Remote actions are always disabled with a clear reason when not fully online (spec 14.11) — local Git operations never route through this check. */
export function remoteActionAvailability(connectivity: GithubConnectivity): RemoteActionAvailability {
  if (connectivity === 'online') {
    return { available: true, reason: null };
  }
  return { available: false, reason: UNAVAILABLE_REASON[connectivity] };
}

export type DraftRemoteMutationKind =
  | 'publish-repository'
  | 'create-pull-request'
  | 'merge-pull-request'
  | 'trigger-workflow-dispatch'
  | 'publish-release';

export interface DraftRemoteMutation<TPayload> {
  readonly id: string;
  readonly kind: DraftRemoteMutationKind;
  readonly payload: TPayload;
  readonly createdAt: string;
  readonly reviewed: boolean;
}

/** Creates a draft — never submitted automatically, including on reconnect (spec 14.11: "unless the user explicitly creates a draft operation and reviews it"). */
export function createDraftRemoteMutation<TPayload>(
  id: string,
  kind: DraftRemoteMutationKind,
  payload: TPayload,
  createdAt: string,
): DraftRemoteMutation<TPayload> {
  return { id, kind, payload, createdAt, reviewed: false };
}

export function markDraftReviewed<TPayload>(draft: DraftRemoteMutation<TPayload>): DraftRemoteMutation<TPayload> {
  return { ...draft, reviewed: true };
}

export class DraftNotReviewedError extends Error {
  constructor(public readonly draftId: string) {
    super(`Draft remote mutation "${draftId}" has not been explicitly reviewed and cannot be submitted automatically.`);
    this.name = 'DraftNotReviewedError';
  }
}

/**
 * The single, explicit gate a draft must pass through to actually run
 * (spec 39: never queue an automatic remote mutation for later without
 * explicit user review). There is deliberately no "submit all drafts on
 * reconnect" helper anywhere in this package — every draft's submission
 * is a distinct user action that calls this function once, by hand.
 */
export function assertDraftReviewedBeforeSubmit<TPayload>(draft: DraftRemoteMutation<TPayload>): void {
  if (!draft.reviewed) {
    throw new DraftNotReviewedError(draft.id);
  }
}
