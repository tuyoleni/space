/**
 * Real (non-fake) implementations of the scan ports, backed by Node's
 * standard library. This is the only file in the scan/detection path that
 * actually touches the OS — everything else takes these as injected
 * arguments so it can be tested without shelling out (spec section 33).
 *
 * Safe by construction: `resolveOnPath`/`runCommand` never pass
 * `shell: true` (spec 25.3.2), and nothing here writes, installs, or
 * authenticates (spec 8.2).
 */
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommandExecutionResult, CommandOnPathResolver, CommandRunner, FileSystemPort, OsInfoPort, ScanDependencies, SupportedPlatform } from './types';
import type { ProjectDetectionFsPort } from './project-detection';

function toSupportedPlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === 'darwin' || platform === 'win32') {
    return platform;
  }
  throw new Error(`Unsupported platform: ${platform} (Space targets macOS and Windows only, spec section 1.1)`);
}

export const nodeOsInfoPort: OsInfoPort = {
  platform: () => toSupportedPlatform(process.platform),
  architecture: () => os.arch(),
  release: () => os.release(),
  homeDir: () => os.homedir(),
  shellPath: () => process.env['SHELL'] ?? (process.platform === 'win32' ? process.env['COMSPEC'] ?? null : null),
  diskFreeBytes: async (targetPath: string) => {
    // Walk up to the nearest existing ancestor — the target project
    // directory itself may not exist yet, but disk space is a property of
    // the volume it would be created on (read-only: never creates it).
    let current = targetPath;
    for (let i = 0; i < 20; i += 1) {
      try {
        const stats = await fs.statfs(current);
        return stats.bfree * stats.bsize;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) {
          return null;
        }
        current = parent;
      }
    }
    return null;
  },
};

/** `command -v` on POSIX, `where` on Windows — read-only PATH resolution, no shell. */
export const nodeResolveOnPath: CommandOnPathResolver = async (executable) => {
  const isWindows = process.platform === 'win32';
  const lookup = isWindows ? 'where' : 'command';
  const args = isWindows ? [executable] : ['-v', executable];
  return new Promise((resolve) => {
    const child = spawn(lookup, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
      resolve(first?.trim() ?? null);
    });
  });
};

/**
 * Directories package managers install into that are frequently *not* on
 * Space's own process PATH: Homebrew's Apple Silicon/Intel prefixes and
 * Volta's shim directory. Space's PATH is fixed at the moment its process
 * launched — a GUI-launched app inherits launchd's minimal PATH (no
 * Homebrew at all), and a tool installed *during* this run was never on
 * PATH to begin with, on any launch path. `command -v`/`where` alone
 * reports "not found" in both cases for a binary that is really sitting
 * on disk.
 */
function wellKnownToolDirs(homeDir: string): readonly string[] {
  if (process.platform === 'darwin') {
    return ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', path.join(homeDir, '.volta', 'bin')];
  }
  if (process.platform === 'win32') {
    return [path.join(homeDir, 'AppData', 'Local', 'Volta', 'bin')];
  }
  return [];
}

/**
 * `nodeResolveOnPath`, then a fallback scan of `wellKnownToolDirs` for the
 * same executable. Use this (not `nodeResolveOnPath` alone) for any tool
 * Space itself may have just installed, or that commonly lives outside a
 * GUI-launched process's PATH (spec 8.4/8.6, ADR-004).
 */
export async function resolveKnownToolPath(executable: string, homeDir: string = os.homedir()): Promise<string | null> {
  const fromPath = await nodeResolveOnPath(executable);
  if (fromPath) {
    return fromPath;
  }
  const candidateName = process.platform === 'win32' ? `${executable}.exe` : executable;
  for (const dir of wellKnownToolDirs(homeDir)) {
    const candidate = path.join(dir, candidateName);
    try {
      // eslint-disable-next-line no-await-in-loop -- a short, fixed list of directories; sequential is fine and keeps resolution order (Apple Silicon before Intel) meaningful.
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not here — try the next well-known directory.
    }
  }
  return null;
}

export const nodeRunCommand: CommandRunner = (executable, args, options) => {
  return new Promise<CommandExecutionResult>((resolve, reject) => {
    const maxOutputBytes = options?.maxOutputBytes ?? 16 * 1024 * 1024;
    const child = spawn(executable, [...args], {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = options?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs)
      : undefined;

    const appendBounded = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf-8');
      return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        stderr = appendBounded(stderr, Buffer.from(`\nSpace stopped the command after ${options?.timeoutMs ?? 0} ms.`, 'utf8'));
      }
      resolve({ exitCode: code, stdout, stderr });
    });
  });
};

export const nodeFileSystemPort: FileSystemPort = {
  exists: async (targetPath) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  },
  canWrite: async (targetPath) => {
    try {
      await fs.access(targetPath, fs.constants.W_OK);
      return true;
    } catch {
      // The target itself may not exist yet; fall back to checking its
      // nearest existing parent directory, without creating anything.
      let current = targetPath;
      for (let i = 0; i < 20; i += 1) {
        const parent = path.dirname(current);
        if (parent === current) {
          return false;
        }
        try {
          await fs.access(parent, fs.constants.W_OK);
          return true;
        } catch {
          current = parent;
        }
      }
      return false;
    }
  },
  readTextFile: async (targetPath) => {
    try {
      return await fs.readFile(targetPath, 'utf-8');
    } catch {
      return null;
    }
  },
};

/** Read-only Node adapter for PRJ-002 project detection — never writes, never opens env files. */
export const nodeProjectDetectionFs: ProjectDetectionFsPort = {
  listDirectory: async (targetPath) => {
    try {
      return await fs.readdir(targetPath);
    } catch {
      return [];
    }
  },
  readTextFile: async (targetPath) => {
    try {
      return await fs.readFile(targetPath, 'utf-8');
    } catch {
      return null;
    }
  },
};

export function createNodeScanDependencies(defaultProjectLocation: string): ScanDependencies {
  return {
    os: nodeOsInfoPort,
    resolveOnPath: nodeResolveOnPath,
    runCommand: nodeRunCommand,
    fs: nodeFileSystemPort,
    defaultProjectLocation,
  };
}
