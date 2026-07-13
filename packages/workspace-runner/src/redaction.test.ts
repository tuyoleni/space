import { describe, expect, it } from 'vitest';
import { isSensitivePath, RedactionRegistry, redactSecretPatterns } from './redaction';

describe('RedactionRegistry', () => {
  it('redacts every registered secret value from text', () => {
    const registry = new RedactionRegistry();
    registry.register('super-secret-token');
    expect(registry.redact('the token is super-secret-token here')).toBe('the token is [REDACTED] here');
  });

  it('ignores empty-string registration (would redact everything)', () => {
    const registry = new RedactionRegistry();
    registry.register('');
    expect(registry.redact('hello world')).toBe('hello world');
  });

  it('leaves text untouched when nothing is registered', () => {
    const registry = new RedactionRegistry();
    expect(registry.redact('nothing secret here')).toBe('nothing secret here');
  });
});

describe('redactSecretPatterns', () => {
  it('redacts a GitHub personal access token shape', () => {
    const text = 'token: ghp_' + 'a'.repeat(36);
    expect(redactSecretPatterns(text)).toBe('token: [REDACTED]');
  });

  it('redacts an AWS access key id', () => {
    const text = 'AKIA' + 'A'.repeat(16);
    expect(redactSecretPatterns(text)).toBe('[REDACTED]');
  });

  it('redacts a PEM private key block', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----';
    expect(redactSecretPatterns(text)).toBe('[REDACTED]');
  });

  it('redacts a generic key=value secret assignment', () => {
    const text = 'const apiKey = "abcd1234efgh5678";';
    expect(redactSecretPatterns(text)).toContain('[REDACTED]');
    expect(redactSecretPatterns(text)).not.toContain('abcd1234efgh5678');
  });

  it('leaves ordinary source code untouched', () => {
    const text = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
    expect(redactSecretPatterns(text)).toBe(text);
  });
});

describe('isSensitivePath', () => {
  it.each([
    '.env',
    '.env.production',
    'server/.env.local',
    'id_rsa',
    'id_ed25519',
    'id_rsa.pub',
    'config/private.pem',
    'certs/site.key',
    'credentials',
    'credentials.json',
    'secrets.yaml',
    '.npmrc',
    '.netrc',
    '.aws/credentials',
    '.ssh/config',
    '.git-credentials',
  ])('flags %s as sensitive', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each(['src/index.ts', 'README.md', 'package.json', 'a.txt', 'assets/logo.png'])(
    'does not flag %s as sensitive',
    (path) => {
      expect(isSensitivePath(path)).toBe(false);
    },
  );
});
