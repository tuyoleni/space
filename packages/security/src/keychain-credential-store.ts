/**
 * Real `CredentialStorePort` implementation (spec 5.6, 24.1). macOS uses
 * the `security` command-line tool against the login Keychain — the
 * established credential API spec 24.1 asks for, not `safeStorage` (spec
 * 24.1: "safeStorage may encrypt local small values but must be evaluated
 * carefully by platform; use established keychain/credential APIs where
 * stronger semantics are required"). Windows has no equivalent
 * single-command CLI for round-tripping an arbitrary secret through
 * Credential Manager, so it uses the Windows Data Protection API (DPAPI)
 * via PowerShell to encrypt the secret at rest, scoped to the current
 * Windows user — the same underlying primitive Credential Manager itself
 * is built on.
 *
 * Per this milestone's explicit boundary: the Windows path is written
 * correctly per this design but has not been executed on a Windows
 * machine (none is available in this environment) — it is unverified by
 * execution, the same status M3's Windows bootstrap plan carries.
 *
 * All real spawning goes through the injected `OsCredentialExecutor`
 * (mirrors `GitExecutor`/`GhExecutor`), so this class's logic is tested
 * against a fake executor — never a real keychain call.
 */
import path from 'node:path';
import type { CredentialRef, CredentialStorePort } from './credential-store';
import type { OsCredentialExecutor } from './os-credential-executor';

export type CredentialStorePlatform = 'darwin' | 'win32';

export interface KeychainCredentialStoreOptions {
  readonly platform: CredentialStorePlatform;
  readonly executor: OsCredentialExecutor;
  /** Required (and only used) on win32 — a Space-owned directory for DPAPI-protected blobs, one file per credential. */
  readonly windowsCredentialsDir?: string;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function macOsSetArgs(ref: CredentialRef, secret: string): { readonly executable: string; readonly args: readonly string[] } {
  return {
    executable: 'security',
    args: ['add-generic-password', '-a', ref.account, '-s', ref.service, '-w', secret, '-U'],
  };
}

export function macOsGetArgs(ref: CredentialRef): { readonly executable: string; readonly args: readonly string[] } {
  return { executable: 'security', args: ['find-generic-password', '-a', ref.account, '-s', ref.service, '-w'] };
}

export function macOsDeleteArgs(ref: CredentialRef): { readonly executable: string; readonly args: readonly string[] } {
  return { executable: 'security', args: ['delete-generic-password', '-a', ref.account, '-s', ref.service] };
}

function windowsBlobPath(dir: string, ref: CredentialRef): string {
  return path.join(dir, `${sanitizeForFilename(ref.service)}__${sanitizeForFilename(ref.account)}.bin`);
}

function windowsSetScript(secret: string, filePath: string): string {
  const secretLiteral = `'${escapePowerShellSingleQuoted(secret)}'`;
  const pathLiteral = `'${escapePowerShellSingleQuoted(filePath)}'`;
  return [
    `$bytes = [System.Text.Encoding]::UTF8.GetBytes(${secretLiteral})`,
    '$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    `[System.IO.File]::WriteAllBytes(${pathLiteral}, $protected)`,
  ].join('; ');
}

function windowsGetScript(filePath: string): string {
  const pathLiteral = `'${escapePowerShellSingleQuoted(filePath)}'`;
  return [
    `if (-not (Test-Path -LiteralPath ${pathLiteral})) { exit 1 }`,
    `$protected = [System.IO.File]::ReadAllBytes(${pathLiteral})`,
    '$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[System.Text.Encoding]::UTF8.GetString($bytes)',
  ].join('; ');
}

function windowsDeleteScript(filePath: string): string {
  const pathLiteral = `'${escapePowerShellSingleQuoted(filePath)}'`;
  return `Remove-Item -LiteralPath ${pathLiteral} -ErrorAction SilentlyContinue`;
}

export class NodeKeychainCredentialStore implements CredentialStorePort {
  constructor(private readonly options: KeychainCredentialStoreOptions) {
    if (options.platform === 'win32' && !options.windowsCredentialsDir) {
      throw new Error('NodeKeychainCredentialStore on win32 requires windowsCredentialsDir');
    }
  }

  async set(ref: CredentialRef, secret: string): Promise<void> {
    if (this.options.platform === 'darwin') {
      const { executable, args } = macOsSetArgs(ref, secret);
      const result = await this.options.executor(executable, args);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to store credential in Keychain: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
      }
      return;
    }
    const filePath = windowsBlobPath(this.options.windowsCredentialsDir as string, ref);
    const result = await this.options.executor('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsSetScript(secret, filePath)]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to store credential via DPAPI: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
    }
  }

  async get(ref: CredentialRef): Promise<string | null> {
    if (this.options.platform === 'darwin') {
      const { executable, args } = macOsGetArgs(ref);
      const result = await this.options.executor(executable, args);
      if (result.exitCode !== 0) {
        return null;
      }
      return result.stdout.replace(/\n$/, '');
    }
    const filePath = windowsBlobPath(this.options.windowsCredentialsDir as string, ref);
    const result = await this.options.executor('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsGetScript(filePath)]);
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      return null;
    }
    return result.stdout.replace(/\r?\n$/, '');
  }

  async delete(ref: CredentialRef): Promise<void> {
    if (this.options.platform === 'darwin') {
      const { executable, args } = macOsDeleteArgs(ref);
      await this.options.executor(executable, args);
      return;
    }
    const filePath = windowsBlobPath(this.options.windowsCredentialsDir as string, ref);
    await this.options.executor('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsDeleteScript(filePath)]);
  }
}
