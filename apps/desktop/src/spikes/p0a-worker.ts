/**
 * P0-A technical spike worker (spec section 36.1.1).
 *
 * Runs inside an Electron `utilityProcess` (not the renderer, not the main
 * process). Proves, in a real packaged/dev Electron process:
 *   1. better-sqlite3 opens a database file and performs a real write+read.
 *   2. node-pty spawns a real shell and returns real output.
 *
 * Communicates results back to the main process via process messaging
 * only - this worker has no IPC surface reachable by the renderer.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import * as pty from 'node-pty';

type P0AResult =
  | { ok: true; sqlite: { version: string; roundtrip: string }; pty: { shell: string; output: string } }
  | { ok: false; stage: 'sqlite' | 'pty'; error: string };

async function runSqliteCheck(dbPath: string): Promise<{ version: string; roundtrip: string }> {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS p0a_spike (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO p0a_spike (value) VALUES (?)');
    const marker = `p0a-${Date.now()}`;
    insert.run(marker);
    const row = db.prepare('SELECT value FROM p0a_spike ORDER BY id DESC LIMIT 1').get() as
      | { value: string }
      | undefined;
    if (!row || row.value !== marker) {
      throw new Error('SQLite roundtrip mismatch');
    }
    const versionRow = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    return { version: versionRow.v, roundtrip: row.value };
  } finally {
    db.close();
  }
}

async function runPtyCheck(): Promise<{ shell: string; output: string }> {
  const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
  return new Promise((resolve, reject) => {
    let buffer = '';
    const term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    });

    const timeout = setTimeout(() => {
      term.kill();
      reject(new Error('PTY spike timed out waiting for output'));
    }, 8000);

    term.onData((data) => {
      buffer += data;
      if (buffer.includes('p0a-pty-marker-done')) {
        clearTimeout(timeout);
        term.kill();
        resolve({ shell, output: buffer });
      }
    });

    term.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (!buffer.includes('p0a-pty-marker-done')) {
        reject(new Error(`PTY exited early (code ${exitCode}) before marker was seen`));
      }
    });

    const markerCommand =
      os.platform() === 'win32'
        ? 'echo p0a-pty-marker-done\r'
        : 'echo p0a-pty-marker-done\r';
    term.write(markerCommand);
  });
}

async function main(): Promise<void> {
  const dbPath = path.join(os.tmpdir(), `space-p0a-spike-${process.pid}.sqlite`);

  let sqliteResult: { version: string; roundtrip: string };
  try {
    sqliteResult = await runSqliteCheck(dbPath);
  } catch (error) {
    const result: P0AResult = { ok: false, stage: 'sqlite', error: String(error) };
    process.parentPort?.postMessage(result);
    return;
  } finally {
    fs.rm(dbPath, { force: true }, () => undefined);
    fs.rm(`${dbPath}-wal`, { force: true }, () => undefined);
    fs.rm(`${dbPath}-shm`, { force: true }, () => undefined);
  }

  let ptyResult: { shell: string; output: string };
  try {
    ptyResult = await runPtyCheck();
  } catch (error) {
    const result: P0AResult = { ok: false, stage: 'pty', error: String(error) };
    process.parentPort?.postMessage(result);
    return;
  }

  const result: P0AResult = { ok: true, sqlite: sqliteResult, pty: ptyResult };
  process.parentPort?.postMessage(result);
}

// Support an intentional-crash mode so the main process can prove it
// detects and can respawn a crashed worker (utility-process crash recovery,
// spec section 36.1.1).
if (process.argv.includes('--crash-now')) {
  setTimeout(() => {
    process.exit(1);
  }, 200);
} else {
  void main();
}
