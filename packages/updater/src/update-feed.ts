/**
 * The update-feed seam (spec 31.3, 31.4). `UpdateFeedPort` is the one
 * boundary this package ever crosses to learn about a new version —
 * injected, never a hard-coded URL, so nothing in this package (or its
 * tests) can accidentally point at a real update server. Space does not
 * operate a real update server today; the hard safety boundary for this
 * milestone requires this stay a fake-only seam in every test, and the
 * caller (apps/desktop) is documented to leave it unwired until a real,
 * paid update-hosting decision is made — see ADR-009.
 */
import type { ReleaseChannel } from './release-channel';

export interface UpdateArtifactInfo {
  readonly version: string;
  /** Where the update artifact itself would be fetched from — never fetched by this package; the concrete Electron updater integration owns the download. */
  readonly downloadUrl: string;
  /** Base64-encoded signature over the artifact bytes (spec 31.2/31.3: "Updates must be signed and verified"). */
  readonly signatureBase64: string;
  /** Hex-encoded SHA-256 of the artifact, checked before signature verification as a cheap first integrity gate. */
  readonly sha256Hex: string;
  readonly releaseNotesUrl?: string;
}

export interface UpdateFeedPort {
  /** Returns the newest available update for `channel` newer than `currentVersion`, or null when already current. Never mutates anything; a real implementation is a plain read-only HTTP GET. */
  checkForUpdate(currentVersion: string, channel: ReleaseChannel): Promise<UpdateArtifactInfo | null>;
}
