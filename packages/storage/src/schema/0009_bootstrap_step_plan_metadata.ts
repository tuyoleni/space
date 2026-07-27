/**
 * Carries two plan-time facts about a bootstrap step through to the UI.
 * Additive migration (ADR-003): never edit 0001-0008 once shipped.
 *
 * A `PlannedStep` already knows its `displayName` ("Apple Command Line
 * Tools", "Homebrew") and whether it `changesMachineState`, but neither was
 * persisted, so the renderer had to guess from `toolId` alone. Two visible
 * bugs came out of that: steps with no `toolId` fell back to echoing their
 * explanation as the title, printing the same sentence twice; and the
 * onboarding button read "Install required tools" on a machine where the
 * only planned step was a passive check that installs nothing.
 *
 * Both columns are nullable so rows written before this migration keep the
 * old, unknown-metadata behaviour rather than claiming a wrong answer.
 * `changes_machine_state` is the plan's intent, deliberately distinct from
 * the existing `changed_machine_state`, which records what a step actually
 * did once it ran.
 */
export const MIGRATION_0009_BOOTSTRAP_STEP_PLAN_METADATA = `
ALTER TABLE bootstrap_steps ADD COLUMN display_name TEXT;
ALTER TABLE bootstrap_steps ADD COLUMN changes_machine_state INTEGER;
`;
