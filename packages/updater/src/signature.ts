/**
 * Real signature verification for an update artifact (spec 31.2/31.3:
 * "Updates must be signed and verified"). Uses Node's real `crypto`
 * module — this is genuine cryptographic verification, not a stub —
 * against an injected public key, so this package never embeds or
 * assumes a specific production signing identity. Tests exercise it end
 * to end with an ephemeral keypair generated inside the test itself
 * (`crypto.generateKeyPairSync`), never a real Space release key; the
 * hard safety boundary for this milestone is "no real code-signing
 * certificates," not "no real cryptography under test."
 */
import { createVerify, timingSafeEqual, createHash } from 'node:crypto';

export interface VerifyUpdateArtifactInput {
  /** PEM-encoded public key Space's real release process would sign with the matching private key for (provisioned separately — see ADR-009; never embedded in this package). */
  readonly publicKeyPem: string;
  readonly artifact: Buffer;
  readonly signatureBase64: string;
  readonly expectedSha256Hex: string;
}

export interface VerifyUpdateArtifactResult {
  readonly verified: boolean;
  readonly reason: string | null;
}

/**
 * Two real, independent checks, both required: the artifact's SHA-256
 * matches what the feed advertised (constant-time compare — this is
 * security-sensitive, not just an equality check for its own sake), and
 * the signature verifies against `publicKeyPem` using RSA-SHA256. Either
 * failing means the artifact is rejected; there is no partial-trust path.
 */
export function verifyUpdateArtifact(input: VerifyUpdateArtifactInput): VerifyUpdateArtifactResult {
  const actualSha256Hex = createHash('sha256').update(input.artifact).digest('hex');
  const expected = Buffer.from(input.expectedSha256Hex, 'hex');
  const actual = Buffer.from(actualSha256Hex, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { verified: false, reason: 'sha256 mismatch — artifact does not match what the update feed advertised' };
  }

  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(input.artifact);
    verifier.end();
    const signatureValid = verifier.verify(input.publicKeyPem, Buffer.from(input.signatureBase64, 'base64'));
    return signatureValid ? { verified: true, reason: null } : { verified: false, reason: 'signature does not verify against the configured public key' };
  } catch (error) {
    return { verified: false, reason: `signature verification failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
