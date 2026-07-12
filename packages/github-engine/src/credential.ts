/**
 * The Space-owned credential identifier for a workspace's GitHub token
 * (spec 5.6: "a Space-owned service/account identifier"). Deterministic
 * from (workspaceId, host) alone — the `ServiceConnection` row's
 * `secret_ref_id` is bookkeeping/audit, not something that has to be
 * dereferenced to find this ref, so a token lookup never needs a second
 * database round trip.
 */
import type { CredentialRef } from '@space/security';

export const GITHUB_CREDENTIAL_SERVICE = 'space.github';

export function buildGithubCredentialRef(workspaceId: string, host: string): CredentialRef {
  return { service: GITHUB_CREDENTIAL_SERVICE, account: `${workspaceId}:${host}` };
}
