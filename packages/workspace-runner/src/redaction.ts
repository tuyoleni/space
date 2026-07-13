/**
 * Secret redaction registry (spec sections 21.6, 24.2).
 *
 * When a secret is loaded, its exact value (and safe variants) is
 * registered here; all captured output passes through `redact` before it
 * is persisted or delivered anywhere. Defence in depth: the design must
 * still avoid logging secrets in the first place.
 */
export class RedactionRegistry {
  private readonly secrets = new Set<string>();

  register(value: string): void {
    if (value.length > 0) {
      this.secrets.add(value);
    }
  }

  redact(text: string): string {
    let output = text;
    for (const secret of this.secrets) {
      output = output.split(secret).join('[REDACTED]');
    }
    return output;
  }
}

/**
 * Regex-based detection of common secret shapes, for content that was
 * never explicitly registered with a `RedactionRegistry` (spec 13.3/19.3,
 * added M7: "secrets and known sensitive values must be redacted" before
 * file/diff content is disclosed to a remote model). Defence in depth on
 * top of `RedactionRegistry`, not a replacement — pattern matching only
 * catches shapes it recognizes; it cannot catch an arbitrary secret value
 * that doesn't look like one of these.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[A-Za-z0-9\-_/+=]{8,}["']?/gi,
];

/** Applies every known secret-shape pattern, replacing each match with `[REDACTED]`. */
export function redactSecretPatterns(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

/**
 * Path-based classification of files that must never leave the machine
 * regardless of content (spec 13.3: "raw credentials, environment files,
 * and key material must never be sent"). Matched against the path's base
 * name and extension, case-insensitively, so it applies equally to
 * `.env`, `.env.production`, `server/.env.local`, `id_rsa`, `id_ed25519`,
 * `*.pem`, `*.key`, `*.pfx`, `*.p12`, and common credential file names.
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.env[^/]*$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore|asc|gpg|pgp)$/i,
  /(^|\/)(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.git-credentials$/i,
];

/** True when `path` matches a known credential/environment/key-material shape. */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}
