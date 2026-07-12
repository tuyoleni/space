import { describe, expect, it } from 'vitest';
import { resumeAction, transition } from './bootstrap-state';
import type { BootstrapStatus } from './types';

describe('transition (spec section 8.1, ONB-001)', () => {
  it('walks the full happy path from not_started to complete', () => {
    let status: BootstrapStatus = 'not_started';
    status = transition(status, { type: 'start_scan' }).status;
    expect(status).toBe('scanning');
    status = transition(status, { type: 'scan_complete' }).status;
    expect(status).toBe('plan_ready');
    status = transition(status, { type: 'start_installing' }).status;
    expect(status).toBe('installing');
    status = transition(status, { type: 'all_steps_terminal' }).status;
    expect(status).toBe('verification_required');
    status = transition(status, { type: 'verification_passed' }).status;
    expect(status).toBe('complete');
  });

  it('rejects an event that is not valid from the current status, leaving status unchanged', () => {
    const result = transition('not_started', { type: 'verification_passed' });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('not_started');
  });

  it('moves to blocked on scan failure, and retry returns to plan_ready', () => {
    const failed = transition('scanning', { type: 'scan_failed', reason: 'disk full' });
    expect(failed).toEqual({ status: 'blocked', allowed: true, reason: 'disk full' });
    const retried = transition('blocked', { type: 'retry' });
    expect(retried.status).toBe('plan_ready');
  });

  it('moves to blocked when the plan itself is blocked (e.g. unsupported OS)', () => {
    const result = transition('plan_ready', { type: 'plan_blocked', reason: 'macOS 12 unsupported' });
    expect(result).toEqual({ status: 'blocked', allowed: true, reason: 'macOS 12 unsupported' });
  });

  it('moves installing to partially_complete on user cancellation, not to blocked', () => {
    const result = transition('installing', { type: 'user_cancelled' });
    expect(result.status).toBe('partially_complete');
  });

  it('moves verification_required to partially_complete or blocked depending on outcome', () => {
    expect(transition('verification_required', { type: 'verification_partial' }).status).toBe('partially_complete');
    expect(transition('verification_required', { type: 'verification_failed' }).status).toBe('blocked');
  });

  it('allows retrying from partially_complete back into installing', () => {
    expect(transition('partially_complete', { type: 'start_installing' }).status).toBe('installing');
  });

  it('has no valid outgoing events from complete (terminal)', () => {
    const result = transition('complete', { type: 'start_scan' });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('complete');
  });
});

describe('resumeAction (resumable across restart/network loss/cancellation/step failure)', () => {
  it('maps every status to a concrete resume action', () => {
    const cases: Array<[BootstrapStatus, string]> = [
      ['not_started', 'start_fresh'],
      ['scanning', 'restart_scan'],
      ['plan_ready', 'resume_plan'],
      ['installing', 'resume_installing'],
      ['verification_required', 'resume_verification'],
      ['partially_complete', 'show_partially_complete'],
      ['blocked', 'show_blocked'],
      ['complete', 'show_complete'],
    ];
    for (const [status, expected] of cases) {
      expect(resumeAction(status)).toBe(expected);
    }
  });

  it('resumes a scan from scratch rather than trying to continue a partial one (scan is non-mutating and cheap to redo)', () => {
    expect(resumeAction('scanning')).toBe('restart_scan');
  });

  it('resumes an interrupted install by re-entering the installer loop, not restarting the whole plan', () => {
    expect(resumeAction('installing')).toBe('resume_installing');
  });
});
