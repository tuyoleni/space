import { describe, expect, it } from 'vitest';
import { performScan } from './scan';
import { TOOL_MANIFEST } from './manifest';
import type { CommandExecutionResult, ScanDependencies, SupportedPlatform } from './types';

interface FakeConfig {
  readonly platform: SupportedPlatform;
  readonly onPath: Record<string, string>;
  readonly versionOutputs: Record<string, string>;
  readonly files: Record<string, string>;
  readonly writableTargets: Set<string>;
  readonly diskFreeBytes: number | null;
}

function makeDeps(config: Partial<FakeConfig> = {}): { deps: ScanDependencies; calls: { runCommand: string[]; fsWrite: string[] } } {
  const platform = config.platform ?? 'darwin';
  const onPath = config.onPath ?? {};
  const versionOutputs = config.versionOutputs ?? {};
  const files = config.files ?? {};
  const writableTargets = config.writableTargets ?? new Set<string>();
  const calls = { runCommand: [] as string[], fsWrite: [] as string[] };

  const deps: ScanDependencies = {
    os: {
      platform: () => platform,
      architecture: () => 'arm64',
      release: () => '14.5.0',
      homeDir: () => '/Users/tester',
      shellPath: () => '/bin/zsh',
      diskFreeBytes: async () => config.diskFreeBytes ?? 100_000_000_000,
    },
    resolveOnPath: async (executable: string) => onPath[executable] ?? null,
    runCommand: async (executable: string, args: readonly string[]): Promise<CommandExecutionResult> => {
      calls.runCommand.push(`${executable} ${args.join(' ')}`);
      const key = `${executable} ${args.join(' ')}`;
      const stdout = versionOutputs[key] ?? '';
      return { exitCode: 0, stdout, stderr: '' };
    },
    fs: {
      exists: async (targetPath: string) => targetPath in files,
      canWrite: async (targetPath: string) => {
        calls.fsWrite.push(targetPath);
        return writableTargets.has(targetPath);
      },
      readTextFile: async (targetPath: string) => files[targetPath] ?? null,
    },
    defaultProjectLocation: '/Users/tester/Space',
  };

  return { deps, calls };
}

describe('performScan (spec section 8.2, ONB-002)', () => {
  it('reports OS, architecture, disk space, and shell availability', async () => {
    const { deps } = makeDeps({ diskFreeBytes: 42 });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.platform).toBe('darwin');
    expect(result.architecture).toBe('arm64');
    expect(result.osVersion).toBe('14.5.0');
    expect(result.diskFreeBytes).toBe(42);
    expect(result.shellAvailable).toBe(true);
    expect(result.shellPath).toBe('/bin/zsh');
  });

  it('detects a present tool with a parsed version and minimum-version check', async () => {
    const { deps } = makeDeps({
      onPath: { git: '/usr/bin/git' },
      versionOutputs: { 'git --version': 'git version 2.45.0' },
    });
    const result = await performScan(TOOL_MANIFEST, deps);
    const git = result.tools.find((t) => t.toolId === 'git');
    expect(git).toEqual({ toolId: 'git', found: true, path: '/usr/bin/git', version: '2.45.0', meetsMinimumVersion: true });
  });

  it('flags a present but below-minimum-version tool', async () => {
    const { deps } = makeDeps({
      onPath: { git: '/usr/bin/git' },
      versionOutputs: { 'git --version': 'git version 2.10.0' },
    });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.tools.find((t) => t.toolId === 'git')?.meetsMinimumVersion).toBe(false);
  });

  it('reports a missing tool without invoking its version command', async () => {
    const { deps, calls } = makeDeps({});
    const result = await performScan(TOOL_MANIFEST, deps);
    const git = result.tools.find((t) => t.toolId === 'git');
    expect(git).toEqual({ toolId: 'git', found: false, path: null, version: null, meetsMinimumVersion: null });
    expect(calls.runCommand.some((c) => c.startsWith('git'))).toBe(false);
  });

  it('scans all five manifest tools on darwin', async () => {
    const { deps } = makeDeps({});
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.tools.map((t) => t.toolId).sort()).toEqual(['gh', 'git', 'node', 'npm', 'volta']);
  });

  it('detects Homebrew at the Apple Silicon prefix before falling back to PATH', async () => {
    const { deps } = makeDeps({
      files: { '/opt/homebrew/bin/brew': '' },
      versionOutputs: { '/opt/homebrew/bin/brew --version': 'Homebrew 4.3.1' },
    });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.packageManager).toEqual({ id: 'homebrew', found: true, path: '/opt/homebrew/bin/brew', version: '4.3.1' });
  });

  it('reports Homebrew absent when neither prefix nor PATH resolves it', async () => {
    const { deps } = makeDeps({});
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.packageManager).toEqual({ id: 'homebrew', found: false, path: null, version: null });
  });

  it('detects WinGet on win32 via PATH', async () => {
    const { deps } = makeDeps({
      platform: 'win32',
      onPath: { winget: 'C:\\WinGet\\winget.exe' },
      versionOutputs: { 'C:\\WinGet\\winget.exe --version': 'v1.8.1911' },
    });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.packageManager).toEqual({ id: 'winget', found: true, path: 'C:\\WinGet\\winget.exe', version: 'v1.8.1911' });
  });

  it('detects known editors on PATH', async () => {
    const { deps } = makeDeps({ onPath: { code: '/usr/local/bin/code' } });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.editors).toEqual([
      { id: 'vscode', displayName: 'Visual Studio Code', found: true, path: '/usr/local/bin/code' },
      { id: 'cursor', displayName: 'Cursor', found: false, path: null },
      { id: 'zed', displayName: 'Zed', found: false, path: null },
    ]);
  });

  it('detects existing Space shell integration via the marker comment', async () => {
    const { deps } = makeDeps({ files: { '/Users/tester/.zshrc': 'export PATH=x\n# space-shell-integration\n' } });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.spaceShellIntegrationDetected).toBe(true);
  });

  it('reports no Space shell integration when the marker is absent', async () => {
    const { deps } = makeDeps({ files: { '/Users/tester/.zshrc': 'export PATH=x\n' } });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.spaceShellIntegrationDetected).toBe(false);
  });

  it('reports write access to the default project location without creating anything', async () => {
    const { deps, calls } = makeDeps({ writableTargets: new Set(['/Users/tester/Space']) });
    const result = await performScan(TOOL_MANIFEST, deps);
    expect(result.canWriteDefaultProjectLocation).toBe(true);
    expect(calls.fsWrite).toEqual(['/Users/tester/Space']);
  });
});
