/**
 * @space/agent
 *
 * The intent/change layer (spec section 13, CHG-001..004) and the typed
 * agent-action plan/dispatch layer (spec section 19). Built in M7.
 *
 * - `diff-selection.ts`: `DiffSelection` evidence, built from real parsed
 *   Git diffs, stale-selection detection, and patch composition.
 * - `change-intent.ts`: the exact `ChangeIntent` interface, the
 *   always-available rule-based grouping heuristic, and pure state
 *   transitions (rename/include/exclude/merge/split).
 * - `model-privacy.ts`: what content is eligible to leave the machine if
 *   a remote model is ever used — no network code.
 * - `model-provider.ts`: the DI seam for an optional remote/local model,
 *   plus a canned `FakeModelProvider` for tests. No real provider is
 *   wired up in this codebase (see ADR-008).
 * - `agent-action.ts`: the exact `AgentAction` interface and its Zod
 *   validation boundary for untrusted (e.g. model-produced) plans.
 * - `dispatch.ts`: intrinsic risk computation (never trusts a
 *   caller-supplied risk label) and the typed dispatch layer over
 *   injected handlers bound to real M4/M5/M6 capabilities.
 */
export * from './diff-selection';
export * from './change-intent';
export * from './model-privacy';
export * from './model-provider';
export * from './agent-action';
export * from './dispatch';
