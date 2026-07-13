/**
 * Electron's `ipcRenderer.invoke` wraps a rejected main-process handler's
 * error into a single string on the renderer side, e.g.:
 *
 *   Error invoking remote method 'project:clone': Error: git clone failed:
 *   Cloning into '...'...\nremote: Repository not found.\nfatal: repository
 *   '...' not found
 *
 * The outer "Error invoking remote method '<channel>':" wrapper and the
 * duplicated inner "Error:" prefix are Electron/JS plumbing, not anything
 * the user asked about — they just bury the one sentence that actually says
 * what went wrong. This strips that plumbing so panels can show the real
 * message. Shared by every panel that surfaces `runGuarded`-style errors
 * (App.tsx, GitPanel.tsx, GithubPanel.tsx, AgentPanel.tsx) so the cleanup
 * lives in exactly one place.
 */
export function toErrorMessage(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  let message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '');
  // The remote-method prefix strip can leave one or more redundant
  // "Error: " prefixes behind (from Error#toString() on the original
  // error) — peel those off too, but stop at the real message.
  while (/^Error:\s*/.test(message)) {
    message = message.replace(/^Error:\s*/, '');
  }
  return message || raw;
}
