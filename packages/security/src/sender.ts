import type { IpcMainInvokeEvent } from 'electron';

/**
 * IPC sender validation (spec sections 20.3, 22.1, 25). Every
 * `ipcMain.handle` must call this before doing anything else: it is the
 * enforcement point against a compromised or unexpected sender invoking a
 * privileged channel.
 */
export interface TrustedSender {
  /** webContents.id of the single trusted application window. */
  readonly webContentsId: number;
  /** URL prefixes the sender frame is allowed to have (dev server origin or 'file://'). */
  readonly allowedOriginPrefixes: readonly string[];
}

export interface SenderValidationResult {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export function validateIpcSender(
  event: IpcMainInvokeEvent,
  trusted: TrustedSender,
): SenderValidationResult {
  if (event.senderFrame === null) {
    return { allowed: false, reason: 'sender frame is gone' };
  }
  if (event.sender.id !== trusted.webContentsId) {
    return { allowed: false, reason: 'sender is not the trusted application window' };
  }
  const url = event.senderFrame.url;
  const originOk = trusted.allowedOriginPrefixes.some((prefix) => url.startsWith(prefix));
  if (!originOk) {
    return { allowed: false, reason: `sender frame url "${url}" is not an allowed origin` };
  }
  return { allowed: true, reason: null };
}

/** Throws if the sender fails validation; use at the top of every handler. */
export function assertIpcSender(event: IpcMainInvokeEvent, trusted: TrustedSender): void {
  const result = validateIpcSender(event, trusted);
  if (!result.allowed) {
    throw new Error(`Rejected IPC call: ${result.reason ?? 'unknown sender'}`);
  }
}
