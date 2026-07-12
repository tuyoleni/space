/**
 * Tests the IPC sender enforcement point (spec sections 20.3, 22.1, 25) —
 * every ipcMain.handle in apps/desktop/src/main/ipc.ts calls this first.
 * IpcMainInvokeEvent is imported type-only in sender.ts, so a plain object
 * matching the shape it reads (senderFrame.url, sender.id) is enough; no
 * electron mock needed.
 */
import { describe, expect, it } from 'vitest';
import { assertIpcSender, validateIpcSender, type TrustedSender } from './sender';

function fakeEvent(options: { senderId: number; frameUrl: string | null }) {
  return {
    sender: { id: options.senderId },
    senderFrame: options.frameUrl === null ? null : { url: options.frameUrl },
  } as unknown as Parameters<typeof validateIpcSender>[0];
}

const trusted: TrustedSender = {
  webContentsId: 1,
  allowedOriginPrefixes: ['file://', 'http://localhost:5173'],
};

describe('validateIpcSender', () => {
  it('allows a sender matching the trusted webContentsId and an allowed origin', () => {
    const result = validateIpcSender(fakeEvent({ senderId: 1, frameUrl: 'file:///index.html' }), trusted);
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it('allows a sender whose origin matches any of several allowed prefixes', () => {
    const result = validateIpcSender(
      fakeEvent({ senderId: 1, frameUrl: 'http://localhost:5173/index.html' }),
      trusted,
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects when the sender frame is gone', () => {
    const result = validateIpcSender(fakeEvent({ senderId: 1, frameUrl: null }), trusted);
    expect(result).toEqual({ allowed: false, reason: 'sender frame is gone' });
  });

  it('rejects a sender webContents id that does not match the trusted window', () => {
    const result = validateIpcSender(fakeEvent({ senderId: 999, frameUrl: 'file:///index.html' }), trusted);
    expect(result).toEqual({ allowed: false, reason: 'sender is not the trusted application window' });
  });

  it('checks the webContents id before the origin, even if the origin would fail too', () => {
    const result = validateIpcSender(fakeEvent({ senderId: 999, frameUrl: 'https://evil.example' }), trusted);
    expect(result.reason).toBe('sender is not the trusted application window');
  });

  it('rejects a frame url that does not match any allowed origin prefix', () => {
    const result = validateIpcSender(fakeEvent({ senderId: 1, frameUrl: 'https://evil.example/' }), trusted);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('https://evil.example/');
    expect(result.reason).toContain('not an allowed origin');
  });

  it('rejects a same-origin-looking prefix that is not an exact allowed prefix match', () => {
    // "file://" is allowed but "file:///../evil" style tricks must not pass by
    // accident; startsWith is exact-prefix, not a substring/regex match.
    const result = validateIpcSender(fakeEvent({ senderId: 1, frameUrl: 'evilfile://x' }), trusted);
    expect(result.allowed).toBe(false);
  });
});

describe('assertIpcSender', () => {
  it('does not throw for an allowed sender', () => {
    expect(() =>
      assertIpcSender(fakeEvent({ senderId: 1, frameUrl: 'file:///index.html' }), trusted),
    ).not.toThrow();
  });

  it('throws with the rejection reason for a disallowed sender', () => {
    expect(() => assertIpcSender(fakeEvent({ senderId: 999, frameUrl: 'file:///index.html' }), trusted)).toThrow(
      'Rejected IPC call: sender is not the trusted application window',
    );
  });
});
