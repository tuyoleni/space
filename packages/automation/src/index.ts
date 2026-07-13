/**
 * @space/automation
 *
 * Automation triggers, conditions, and actions (spec section 18).
 * Automations inherit workspace/project boundaries, remote mutations
 * require explicit standing permission, and destructive operations cannot
 * be fully automated in V1.
 *
 * Built in M8 (Phase 7: automation and hardening).
 *
 * - `model.ts`: the exact `Automation`/trigger/condition/action shapes
 *   spec 18.1-18.3 define, and their Zod validation boundary for
 *   untrusted (e.g. renderer-authored) input.
 * - `trigger-matching.ts`: matches a normalised trigger event (produced
 *   from already-existing M4/M5/M6 signals) against automations — no
 *   signal detection lives here.
 * - `dispatch.ts`: intrinsic risk computation and the typed dispatch layer
 *   over injected handlers bound to real M4/M5/M6/M7 capabilities,
 *   mirroring `@space/agent`'s dispatch layer.
 * - `engine.ts`: the execution engine — instant kill switch, bounded
 *   retries, one receipt per run, ordered action execution that stops (does
 *   not skip ahead) on unrecoverable failure.
 */
export * from './model';
export * from './trigger-matching';
export * from './dispatch';
export * from './engine';
