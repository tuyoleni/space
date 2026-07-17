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

/**
 * IPC failures arrive double-wrapped: Electron prefixes
 * `Error invoking remote method '<channel>': ` onto whatever the main
 * process threw, and that error's own `<ClassName>: ` prefix (e.g.
 * `GhCommandError: `) is still attached to `.message`. `GhCommandError`
 * itself formats its message as `gh <args> failed: <reason>`, burying the
 * actually-useful part (the `gh` stderr/stdout) behind the full invoked
 * command line (spec 14.11 GH-009 requires remote-action failures to
 * surface "a clear reason", not a raw nested CLI dump). Strip all of that
 * down to just the reason.
 *
 * This is tuned specifically to `GhCommandError`'s single-line shape,
 * stripping a `<ClassName>:` prefix and a ` failed: ` command-line prefix
 * and collapsing to a single line — `toErrorMessage` above deliberately
 * doesn't do any of that, since it would be wrong for e.g. App.tsx's
 * multi-line `git clone` failures, where the real reason lives on line two
 * or three.
 */
export function friendlyGithubErrorMessage(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  let message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '');
  message = message.replace(/^[A-Za-z][A-Za-z0-9]*Error:\s*/, '');
  message = message.split('\n')[0]?.trim() ?? '';
  const failedMarker = ' failed: ';
  const failedIndex = message.lastIndexOf(failedMarker);
  if (failedIndex !== -1) {
    message = message.slice(failedIndex + failedMarker.length).trim();
  }
  return message || raw.trim();
}
