import { createSign, generateKeyPairSync, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyUpdateArtifact } from './signature';

/**
 * Ephemeral, test-only RSA keypair generated fresh for this test file —
 * never a real Space signing key. This proves `verifyUpdateArtifact` does
 * genuine cryptographic verification (not a stub), without touching any
 * real production credential (the hard safety boundary this milestone
 * prohibits is real code-signing certificates, not testable cryptography).
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function sign(artifact: Buffer): string {
  const signer = createSign('RSA-SHA256');
  signer.update(artifact);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

function sha256Hex(artifact: Buffer): string {
  return createHash('sha256').update(artifact).digest('hex');
}

describe('verifyUpdateArtifact (spec 31.2/31.3: "updates must be signed and verified")', () => {
  it('verifies a real artifact against a real signature and matching hash', () => {
    const artifact = Buffer.from('a real update artifact\'s bytes');
    const result = verifyUpdateArtifact({
      publicKeyPem,
      artifact,
      signatureBase64: sign(artifact),
      expectedSha256Hex: sha256Hex(artifact),
    });
    expect(result).toEqual({ verified: true, reason: null });
  });

  it('rejects when the artifact bytes do not match the advertised sha256 (tampered download)', () => {
    const artifact = Buffer.from('original bytes');
    const tampered = Buffer.from('tampered bytes!!');
    const result = verifyUpdateArtifact({
      publicKeyPem,
      artifact: tampered,
      signatureBase64: sign(artifact),
      expectedSha256Hex: sha256Hex(artifact),
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/sha256 mismatch/);
  });

  it('rejects when the signature does not verify against the public key (wrong signer)', () => {
    const artifact = Buffer.from('a real update artifact');
    const otherKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPrivateKeyPem = otherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const signer = createSign('RSA-SHA256');
    signer.update(artifact);
    signer.end();
    const wrongSignature = signer.sign(otherPrivateKeyPem).toString('base64');

    const result = verifyUpdateArtifact({
      publicKeyPem,
      artifact,
      signatureBase64: wrongSignature,
      expectedSha256Hex: sha256Hex(artifact),
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/signature/);
  });

  it('rejects gracefully (never throws) on a malformed signature', () => {
    const artifact = Buffer.from('bytes');
    const result = verifyUpdateArtifact({
      publicKeyPem,
      artifact,
      signatureBase64: 'not-a-valid-signature',
      expectedSha256Hex: sha256Hex(artifact),
    });
    expect(result.verified).toBe(false);
  });
});
