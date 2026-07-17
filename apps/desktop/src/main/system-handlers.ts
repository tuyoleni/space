/**
 * Real, read-only system resource stats via Node's `os` module — the same
 * primitives Activity Monitor / Task Manager read from, sampled on demand
 * (no background timer the renderer didn't ask for). CPU percent needs two
 * samples of the cumulative per-core counters `os.cpus()` exposes, so this
 * takes a short real delay between them rather than reporting a
 * point-in-time counter as if it were a percentage.
 *
 * Each process also carries its real OS icon: macOS resolves the owning
 * `.app` bundle from the executable path and Electron's `app.getFileIcon`
 * reads the same icon Finder/Activity Monitor show. Icons are cached by
 * bundle path (they never change) so only the first sample pays for them.
 */
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { nodeRunCommand } from '@space/environment';
import type { SystemProcessInfo, SystemStatsResult } from '@space/contracts';

const CPU_SAMPLE_WINDOW_MS = 200;
const PROCESS_LIST_LIMIT = 40;
const PS_TIMEOUT_MS = 5_000;

interface CpuSample {
  readonly idle: number;
  readonly total: number;
}

function sampleCpuTimes(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

interface RawProcess {
  readonly pid: number;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  /** Full executable path (or a bare name like "kernel_task") from `ps comm`. */
  readonly execPath: string;
}

/** Parses `ps -Ao pid,pcpu,pmem,comm -r` lines — comm is the full exec path (no `-c`). */
function parsePsOutput(stdout: string): RawProcess[] {
  const rows: RawProcess[] = [];
  for (const line of stdout.split('\n').slice(1)) {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const [, pid, cpu, mem, execPath] = match;
    rows.push({ pid: Number(pid), cpuPercent: Number(cpu), memoryPercent: Number(mem), execPath: (execPath ?? '').trim() });
    if (rows.length >= PROCESS_LIST_LIMIT) {
      break;
    }
  }
  return rows;
}

/** `/Applications/Arc.app/Contents/MacOS/Arc` → the `.app` bundle path, or null for non-bundled executables. */
function bundlePathOf(execPath: string): string | null {
  const marker = execPath.indexOf('.app/Contents/');
  return marker === -1 ? null : execPath.slice(0, marker + '.app'.length);
}

/** A human name: the `.app` name when bundled, else the executable's basename. */
function displayNameOf(execPath: string, bundlePath: string | null): string {
  if (bundlePath) {
    return path.basename(bundlePath, '.app');
  }
  return path.basename(execPath);
}

export interface SystemHandlers {
  stats(): Promise<SystemStatsResult>;
  processes(): Promise<readonly SystemProcessInfo[]>;
}

export function createSystemHandlers(): SystemHandlers {
  // Icon data URLs cached by the path they were resolved from (bundle or
  // executable) — icons never change, so every poll after the first is free.
  const iconCache = new Map<string, string | null>();

  async function iconFor(resolvePath: string): Promise<string | null> {
    const cached = iconCache.get(resolvePath);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const image = await app.getFileIcon(resolvePath, { size: 'small' });
      const dataUrl = image.isEmpty() ? null : image.toDataURL();
      iconCache.set(resolvePath, dataUrl);
      return dataUrl;
    } catch {
      iconCache.set(resolvePath, null);
      return null;
    }
  }

  async function processCount(): Promise<number | null> {
    if (process.platform !== 'darwin') {
      return null;
    }
    const result = await nodeRunCommand('ps', ['-Ao', 'pid='], { timeoutMs: PS_TIMEOUT_MS }).catch(() => null);
    if (!result || result.exitCode !== 0) {
      return null;
    }
    return result.stdout.split('\n').filter((line) => line.trim().length > 0).length;
  }

  async function stats(): Promise<SystemStatsResult> {
    const before = sampleCpuTimes();
    const [count] = await Promise.all([processCount(), new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_WINDOW_MS))]);
    const after = sampleCpuTimes();

    const idleDelta = after.idle - before.idle;
    const totalDelta = after.total - before.total;
    const cpuPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;

    const [load1, load5, load15] = os.loadavg();

    return {
      sampledAt: new Date().toISOString(),
      cpuPercent,
      cpuCount: os.cpus().length,
      memoryTotalBytes: os.totalmem(),
      memoryFreeBytes: os.freemem(),
      loadAverage: [load1 ?? 0, load5 ?? 0, load15 ?? 0],
      processCount: count,
    };
  }

  async function processes(): Promise<readonly SystemProcessInfo[]> {
    // `-r` sorts by CPU; no `-c`, so `comm` is the full executable path,
    // which lets us resolve the owning .app bundle and its real icon.
    if (process.platform !== 'darwin') {
      return [];
    }
    const result = await nodeRunCommand('ps', ['-Ao', 'pid,pcpu,pmem,comm', '-r'], { timeoutMs: PS_TIMEOUT_MS }).catch(() => null);
    if (!result || result.exitCode !== 0) {
      return [];
    }
    const raw = parsePsOutput(result.stdout);
    return Promise.all(
      raw.map(async (proc) => {
        const bundlePath = bundlePathOf(proc.execPath);
        const iconDataUrl = await iconFor(bundlePath ?? proc.execPath);
        return {
          pid: proc.pid,
          name: displayNameOf(proc.execPath, bundlePath),
          cpuPercent: proc.cpuPercent,
          memoryPercent: proc.memoryPercent,
          iconDataUrl,
        };
      }),
    );
  }

  return { stats, processes };
}
