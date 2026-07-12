import { describe, expect, it } from 'vitest';
import { InMemoryCredentialStore } from './credential-store';

describe('InMemoryCredentialStore', () => {
  it('returns null for a credential that was never set', async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.get({ service: 'space.github', account: 'ws1:github.com' })).toBeNull();
  });

  it('round-trips a secret and never returns it under a different account', async () => {
    const store = new InMemoryCredentialStore();
    await store.set({ service: 'space.github', account: 'ws1:github.com' }, 'gho_secret');
    expect(await store.get({ service: 'space.github', account: 'ws1:github.com' })).toBe('gho_secret');
    expect(await store.get({ service: 'space.github', account: 'ws2:github.com' })).toBeNull();
  });

  it('deletes a credential', async () => {
    const store = new InMemoryCredentialStore();
    const ref = { service: 'space.github', account: 'ws1:github.com' };
    await store.set(ref, 'gho_secret');
    await store.delete(ref);
    expect(await store.get(ref)).toBeNull();
    expect(store.has(ref)).toBe(false);
  });

  it('overwrites rather than duplicating on a second set for the same ref', async () => {
    const store = new InMemoryCredentialStore();
    const ref = { service: 'space.github', account: 'ws1:github.com' };
    await store.set(ref, 'first');
    await store.set(ref, 'second');
    expect(await store.get(ref)).toBe('second');
  });
});
