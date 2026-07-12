/**
 * P0-A technical spike runner (spec section 36.1.1), invoked from the main
 * process. Proves:
 *   - node-pty and better-sqlite3 operate correctly from a real Electron
 *     utility process (not plain Node, not the renderer).
 *   - the main process detects a crashed utility process and can respawn
 *     it with bounded, non-infinite retry (utility-process crash recovery).
 *
 * This is throwaway spike code, not production architecture: the real
 * Workspace Process Runner (M2/@space/workspace-runner) supersedes it.
 */
import { app, utilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

interface SpikeReport {
  timestamp: string;
  electronVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  normalRun: { ok: boolean; detail: unknown };
  crashRecovery: { crashDetected: boolean; respawnSucceeded: boolean };
}

function workerPath(): string {
  return path.join(__dirname, 'p0a-worker.js');
}

async function runNormal(): Promise<{ ok: boolean; detail: unknown }> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(workerPath(), [], { stdio: 'pipe' });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, detail: 'timed out waiting for worker message' });
    }, 12000);

    child.once('message', (message) => {
      clearTimeout(timeout);
      resolve({ ok: Boolean((message as { ok?: boolean }).ok), detail: message });
      child.kill();
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ ok: false, detail: `worker exited early with code ${code}` });
      }
    });
  });
}

async function runCrashRecovery(): Promise<{ crashDetected: boolean; respawnSucceeded: boolean }> {
  const crashDetected = await new Promise<boolean>((resolve) => {
    const child = utilityProcess.fork(workerPath(), ['--crash-now'], { stdio: 'pipe' });
    const timeout = setTimeout(() => resolve(false), 5000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code !== 0);
    });
  });

  // Prove the main process can respawn a fresh worker after the crash.
  const respawn = await runNormal();
  return { crashDetected, respawnSucceeded: respawn.ok };
}

export async function runP0ASpike(): Promise<void> {
  const normalRun = await runNormal();
  const crashRecovery = await runCrashRecovery();

  const report: SpikeReport = {
    timestamp: new Date().toISOString(),
    electronVersion: process.versions.electron ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    normalRun,
    crashRecovery,
  };

  const reportPath = path.join(app.getPath('userData'), 'p0a-spike-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // eslint-disable-next-line no-console
  console.log('[P0-A spike] report written to', reportPath);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  const passed = normalRun.ok && crashRecovery.crashDetected && crashRecovery.respawnSucceeded;
  // eslint-disable-next-line no-console
  console.log(passed ? '[P0-A spike] PASS' : '[P0-A spike] FAIL');

  app.quit();
}
