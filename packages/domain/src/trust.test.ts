import { describe, expect, it } from 'vitest';
import { applyTrustDecision, assertTrusted, checkTrust, explainGatedOperation, TrustGateError } from './trust';

describe('checkTrust', () => {
  it('permits every gated operation for a trusted project', () => {
    for (const operation of [
      'package-install',
      'lifecycle-script',
      'project-binary',
      'source-shell-file',
      'load-project-content',
      'inject-secrets',
      'agent-file-modify',
      'automation-script',
    ] as const) {
      expect(checkTrust({ trustState: 'trusted', operation })).toEqual({ permitted: true, reason: null });
    }
  });

  it('blocks every gated operation for an untrusted project by default', () => {
    const result = checkTrust({ trustState: 'untrusted', operation: 'package-install' });
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/untrusted/);
    expect(result.reason).toContain(explainGatedOperation('package-install'));
  });

  it('permits an untrusted project only when allowOnce is explicitly true', () => {
    expect(
      checkTrust({ trustState: 'untrusted', operation: 'lifecycle-script', allowOnce: true }),
    ).toEqual({ permitted: true, reason: null });
    expect(
      checkTrust({ trustState: 'untrusted', operation: 'lifecycle-script', allowOnce: false }),
    ).toMatchObject({ permitted: false });
  });
});

describe('assertTrusted', () => {
  it('does not throw when permitted', () => {
    expect(() => assertTrusted({ trustState: 'trusted', operation: 'project-binary' })).not.toThrow();
  });

  it('throws a TrustGateError carrying the operation when blocked', () => {
    try {
      assertTrusted({ trustState: 'untrusted', operation: 'inject-secrets' });
      throw new Error('expected assertTrusted to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TrustGateError);
      expect((error as TrustGateError).operation).toBe('inject-secrets');
    }
  });
});

describe('applyTrustDecision', () => {
  it('trust-this-project moves an untrusted project to trusted', () => {
    expect(applyTrustDecision('untrusted', 'trust-this-project')).toBe('trusted');
  });

  it('keep-untrusted and allow-once never change the persisted state', () => {
    expect(applyTrustDecision('untrusted', 'keep-untrusted')).toBe('untrusted');
    expect(applyTrustDecision('untrusted', 'allow-once')).toBe('untrusted');
    expect(applyTrustDecision('trusted', 'keep-untrusted')).toBe('trusted');
  });
});
