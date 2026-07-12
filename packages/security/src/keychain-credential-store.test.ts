import { describe, expect, it } from 'vitest';
import { macOsDeleteArgs, macOsGetArgs, macOsSetArgs, NodeKeychainCredentialStore } from './keychain-credential-store';
import type { OsCredentialExecutor } from './os-credential-executor';

const REF = { service: 'space.github', account: 'ws1:github.com' };

describe('macOS arg builders', () => {
  it('builds add-generic-password with -U to update in place, never duplicating an entry', () => {
    expect(macOsSetArgs(REF, 'gho_secret')).toEqual({
      executable: 'security',
      args: ['add-generic-password', '-a', 'ws1:github.com', '-s', 'space.github', '-w', 'gho_secret', '-U'],
    });
  });

  it('builds find-generic-password requesting only the password field', () => {
    expect(macOsGetArgs(REF)).toEqual({ executable: 'security', args: ['find-generic-password', '-a', 'ws1:github.com', '-s', 'space.github', '-w'] });
  });

  it('builds delete-generic-password', () => {
    expect(macOsDeleteArgs(REF)).toEqual({ executable: 'security', args: ['delete-generic-password', '-a', 'ws1:github.com', '-s', 'space.github'] });
  });
});

describe('NodeKeychainCredentialStore on darwin (fake executor — no real Keychain call)', () => {
  it('sets a credential via the injected executor', async () => {
    let captured: { executable: string; args: readonly string[] } | null = null;
    const executor: OsCredentialExecutor = async (executable, args) => {
      captured = { executable, args };
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const store = new NodeKeychainCredentialStore({ platform: 'darwin', executor });
    await store.set(REF, 'gho_secret');
    expect(captured).toEqual({ executable: 'security', args: macOsSetArgs(REF, 'gho_secret').args });
  });

  it('gets a credential and trims the trailing newline security appends', async () => {
    const executor: OsCredentialExecutor = async () => ({ exitCode: 0, stdout: 'gho_secret\n', stderr: '' });
    const store = new NodeKeychainCredentialStore({ platform: 'darwin', executor });
    expect(await store.get(REF)).toBe('gho_secret');
  });

  it('returns null when the item is not found, rather than throwing', async () => {
    const executor: OsCredentialExecutor = async () => ({ exitCode: 44, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.' });
    const store = new NodeKeychainCredentialStore({ platform: 'darwin', executor });
    expect(await store.get(REF)).toBeNull();
  });

  it('throws with the real stderr when set fails', async () => {
    const executor: OsCredentialExecutor = async () => ({ exitCode: 1, stdout: '', stderr: 'security: some real failure' });
    const store = new NodeKeychainCredentialStore({ platform: 'darwin', executor });
    await expect(store.set(REF, 'x')).rejects.toThrow(/some real failure/);
  });

  it('deletes a credential', async () => {
    let captured: readonly string[] | null = null;
    const executor: OsCredentialExecutor = async (_executable, args) => {
      captured = args;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const store = new NodeKeychainCredentialStore({ platform: 'darwin', executor });
    await store.delete(REF);
    expect(captured).toEqual(macOsDeleteArgs(REF).args);
  });
});

describe('NodeKeychainCredentialStore on win32 (fake executor — DPAPI path is written but unverified by real execution)', () => {
  it('requires windowsCredentialsDir on win32', () => {
    const executor: OsCredentialExecutor = async () => ({ exitCode: 0, stdout: '', stderr: '' });
    expect(() => new NodeKeychainCredentialStore({ platform: 'win32', executor })).toThrow(/windowsCredentialsDir/);
  });

  it('invokes powershell with a DPAPI Protect script scoped to CurrentUser, writing to a per-ref file under the given directory', async () => {
    const captured: { executable: string; args: readonly string[] }[] = [];
    const executor: OsCredentialExecutor = async (executable, args) => {
      captured.push({ executable, args });
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const store = new NodeKeychainCredentialStore({ platform: 'win32', executor, windowsCredentialsDir: 'C:\\Space\\credentials' });
    await store.set(REF, 'gho_secret');
    const call = captured[0];
    expect(call?.executable).toBe('powershell.exe');
    const script = call?.args[call.args.length - 1] ?? '';
    expect(script).toContain('ProtectedData]::Protect');
    expect(script).toContain('CurrentUser');
    expect(script).toContain("'gho_secret'");
    expect(script).toContain('space.github__ws1_github.com.bin');
  });

  it('gets a credential via a DPAPI Unprotect script and trims the trailing newline', async () => {
    const executor: OsCredentialExecutor = async (executable, args) => {
      expect(executable).toBe('powershell.exe');
      expect(args[args.length - 1]).toContain('Unprotect');
      return { exitCode: 0, stdout: 'gho_secret\r\n', stderr: '' };
    };
    const store = new NodeKeychainCredentialStore({ platform: 'win32', executor, windowsCredentialsDir: 'C:\\Space\\credentials' });
    expect(await store.get(REF)).toBe('gho_secret');
  });

  it('returns null when the blob file does not exist', async () => {
    const executor: OsCredentialExecutor = async () => ({ exitCode: 1, stdout: '', stderr: '' });
    const store = new NodeKeychainCredentialStore({ platform: 'win32', executor, windowsCredentialsDir: 'C:\\Space\\credentials' });
    expect(await store.get(REF)).toBeNull();
  });

  it('never embeds an unescaped single quote from the secret into the script (defence against script injection via secret content)', async () => {
    let script = '';
    const executor: OsCredentialExecutor = async (_executable, args) => {
      script = args[args.length - 1] ?? '';
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const store = new NodeKeychainCredentialStore({ platform: 'win32', executor, windowsCredentialsDir: 'C:\\Space\\credentials' });
    await store.set(REF, "o'brien'; Remove-Item C:\\ -Recurse -Force #");
    expect(script).toContain("o''brien''");
  });
});
