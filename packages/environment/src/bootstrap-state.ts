/**
 * ONB-001: first-run state machine (spec section 8.1).
 *
 * A pure reducer: persistence of the resulting status is the caller's
 * responsibility (@space/storage's BootstrapRepository, spec section 8.8).
 * Keeping this pure makes "resumable after application restart, system
 * restart, lost network, installer cancellation, or an individual step
 * failure" a property you can unit test directly: reload a persisted
 * status, ask `resumeAction` what to do next, and go — no live process,
 * timer, or I/O involved.
 */
import type { BootstrapStatus } from './types';

export type BootstrapEvent =
  | { readonly type: 'start_scan' }
  | { readonly type: 'scan_complete' }
  | { readonly type: 'scan_failed'; readonly reason: string }
  | { readonly type: 'plan_built' }
  | { readonly type: 'plan_blocked'; readonly reason: string }
  | { readonly type: 'start_installing' }
  | { readonly type: 'all_steps_terminal' }
  | { readonly type: 'verification_passed' }
  | { readonly type: 'verification_partial' }
  | { readonly type: 'verification_failed' }
  | { readonly type: 'user_cancelled' }
  | { readonly type: 'retry' };

export interface TransitionResult {
  readonly status: BootstrapStatus;
  readonly allowed: boolean;
  readonly reason?: string;
}

const ALLOWED: Record<BootstrapStatus, ReadonlyArray<BootstrapEvent['type']>> = {
  not_started: ['start_scan'],
  scanning: ['scan_complete', 'scan_failed'],
  plan_ready: ['start_installing', 'plan_blocked'],
  installing: ['all_steps_terminal', 'user_cancelled'],
  verification_required: ['verification_passed', 'verification_partial', 'verification_failed'],
  partially_complete: ['retry', 'start_installing'],
  complete: [],
  blocked: ['retry'],
};

/**
 * Applies `event` to `current`. Returns `{ allowed: false }` (current
 * status unchanged) for any transition not in the ONB-001 table instead of
 * throwing — callers resuming from a persisted status after a crash may
 * replay an event that no longer applies, and that must be a no-op, not a
 * crash.
 */
export function transition(current: BootstrapStatus, event: BootstrapEvent): TransitionResult {
  if (!ALLOWED[current].includes(event.type)) {
    return { status: current, allowed: false, reason: `"${event.type}" is not valid from status "${current}"` };
  }

  switch (event.type) {
    case 'start_scan':
      return { status: 'scanning', allowed: true };
    case 'scan_complete':
      return { status: 'plan_ready', allowed: true };
    case 'scan_failed':
      return { status: 'blocked', allowed: true, reason: event.reason };
    case 'plan_built':
      return { status: 'plan_ready', allowed: true };
    case 'plan_blocked':
      return { status: 'blocked', allowed: true, reason: event.reason };
    case 'start_installing':
      return { status: 'installing', allowed: true };
    case 'all_steps_terminal':
      return { status: 'verification_required', allowed: true };
    case 'verification_passed':
      return { status: 'complete', allowed: true };
    case 'verification_partial':
      return { status: 'partially_complete', allowed: true };
    case 'verification_failed':
      return { status: 'blocked', allowed: true, reason: 'Verification failed for one or more required tools.' };
    case 'user_cancelled':
      return { status: 'partially_complete', allowed: true };
    case 'retry':
      return { status: 'plan_ready', allowed: true };
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled bootstrap event: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type ResumeAction =
  | 'start_fresh'
  | 'restart_scan'
  | 'resume_plan'
  | 'resume_installing'
  | 'resume_verification'
  | 'show_partially_complete'
  | 'show_blocked'
  | 'show_complete';

/**
 * What the app should do when it loads a persisted `BootstrapRunRow` on
 * startup (spec 8.1: "resumable ... after application restart"). Scanning
 * always restarts rather than resuming mid-scan, because the scan is
 * non-mutating and cheap to redo in full (spec 8.2) — there is no partial
 * scan state worth preserving.
 */
export function resumeAction(status: BootstrapStatus): ResumeAction {
  switch (status) {
    case 'not_started':
      return 'start_fresh';
    case 'scanning':
      return 'restart_scan';
    case 'plan_ready':
      return 'resume_plan';
    case 'installing':
      return 'resume_installing';
    case 'verification_required':
      return 'resume_verification';
    case 'partially_complete':
      return 'show_partially_complete';
    case 'blocked':
      return 'show_blocked';
    case 'complete':
      return 'show_complete';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled bootstrap status: ${JSON.stringify(exhaustive)}`);
    }
  }
}
