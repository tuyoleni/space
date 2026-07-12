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
