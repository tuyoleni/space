/**
 * Request/response protocol between the main process and the storage
 * worker (ADR-003). Type-only and free of Node/Electron I/O, so it is safe
 * to import from both sides of the process boundary.
 */
export type StorageMethod =
  | 'workspace.list'
  | 'workspace.create'
  | 'workspace.activate'
  | 'project.list'
  | 'project.inspectFolder'
  | 'project.add';

export interface StorageRequest {
  readonly id: string;
  readonly method: StorageMethod;
  readonly payload: unknown;
}

export type StorageResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };
