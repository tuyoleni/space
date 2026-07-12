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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommandExecutionResult, CommandOnPathResolver, CommandRunner, FileSystemPort, OsInfoPort, ScanDependencies, SupportedPlatform } from './types';

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

export const nodeRunCommand: CommandRunner = (executable, args, options) => {
  return new Promise<CommandExecutionResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options?.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = options?.timeoutMs
      ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
      : undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
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

export function createNodeScanDependencies(defaultProjectLocation: string): ScanDependencies {
  return {
    os: nodeOsInfoPort,
    resolveOnPath: nodeResolveOnPath,
    runCommand: nodeRunCommand,
    fs: nodeFileSystemPort,
    defaultProjectLocation,
  };
}
