/**
 * @space/workspace-runner
 *
 * The Workspace Process Runner (spec section 21): the single privileged
 * pipeline every command, terminal, Git operation, GitHub operation,
 * installer, project script, automation, and editor launch must flow
 * through. Renderer code may request approved operations; it must never
 * submit arbitrary shell text.
 *
 * Populated during M2 (secure application foundation) and exercised by the
 * P0-C technical spike (M1).
 */
export {};
