/**
 * Deterministic per-id identity color (e.g. the small dot next to a
 * project name) — hashed from the real id, not assigned/stored anywhere,
 * so it's stable across renders/sessions without any new state.
 */
export function identityColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}
