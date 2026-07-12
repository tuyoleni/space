/**
 * @space/contracts
 *
 * IPC request/response schemas and shared domain types (spec section 22).
 * This package has no runtime dependencies on Electron, Node built-ins, or
 * other @space packages that perform I/O — it is safe to import from both
 * the renderer and any privileged process.
 */
export * from './types';
export * from './channels';
export * from './space-api';
export * from './schemas';
