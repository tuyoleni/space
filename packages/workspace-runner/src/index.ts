/**
 * @space/workspace-runner
 *
 * The Workspace Process Runner (spec section 21): the single privileged
 * pipeline every command, terminal, Git operation, GitHub operation,
 * installer, project script, automation, and editor launch must flow
 * through. Renderer code may request approved operations; it must never
 * submit arbitrary shell text.
 *
 * Core seeded by the P0-C spike; expanded in M2.
 */
export * from './types';
export * from './redaction';
export * from './runner';
export * from './detached';
