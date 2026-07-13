/**
 * Defer/restart-later behaviour (spec 31.3: "Allow defer/restart-later
 * behaviour"). A small, pure state machine — once an update has been
 * downloaded and verified, the user chooses when it actually applies;
 * this never auto-applies on its own.
 */
export type UpdateLifecycleState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'downloading'; readonly version: string }
  | { readonly kind: 'ready-to-apply'; readonly version: string }
  | { readonly kind: 'deferred'; readonly version: string; readonly deferredAt: string }
  | { readonly kind: 'applying'; readonly version: string };

export type UpdateUserChoice = 'apply-now' | 'defer' | 'restart-later';

/**
 * The one place a user's choice turns into a state transition — always
 * from `ready-to-apply` (spec 31.3's apply-safety gate, `evaluateApplyGate`,
 * is a *separate* structural check the caller runs before honouring
 * `apply-now`/`restart-later`; this function only encodes what the user
 * asked for, not whether it is currently safe).
 */
export function applyUserChoice(state: Extract<UpdateLifecycleState, { kind: 'ready-to-apply' }>, choice: UpdateUserChoice, now: () => string): UpdateLifecycleState {
  switch (choice) {
    case 'apply-now':
    case 'restart-later':
      // Both mean "apply", differing only in whether it happens
      // immediately or at the next app restart — a UI-layer distinction
      // the caller (apps/desktop) owns; this state machine represents
      // both as the same 'applying' intent since the safety gate and
      // actual apply mechanics are identical either way.
      return { kind: 'applying', version: state.version };
    case 'defer':
      return { kind: 'deferred', version: state.version, deferredAt: now() };
    default: {
      const exhaustive: never = choice;
      throw new Error(`Unknown update user choice: ${String(exhaustive)}`);
    }
  }
}
