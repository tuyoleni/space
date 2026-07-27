/**
 * Makes better-sqlite3's native binary available to whichever runtime is
 * about to use it.
 *
 * The package builds one `build/Release/better_sqlite3.node`, but Space needs
 * it under two ABIs: Node (vitest) and Electron (the app). Rebuilding for one
 * silently broke the other — a test run left the app crashing at startup deep
 * inside V8 with a SIGTRAP that named no cause, and rebuilding for the app
 * left the whole storage test suite failing to load.
 *
 * So each build is cached the first time it is produced, and switching after
 * that is a file copy instead of a rebuild. Both runtimes stay usable no
 * matter what ran last, and neither ordering needs a human to remember it.
 *
 * Usage: node scripts/use-native-abi.mjs <node|electron>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release');
const BINARY = path.join(RELEASE_DIR, 'better_sqlite3.node');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'space-native-abi');

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('usage: node scripts/use-native-abi.mjs <node|electron>');
  process.exit(1);
}

const cachedFor = (abi) => path.join(CACHE_DIR, `better_sqlite3.${abi}.node`);

/**
 * The ABI a built binary targets, read from the error Node throws when the
 * versions disagree. Loading it is the only honest test — file size and mtime
 * say nothing about which runtime it was compiled for.
 */
function abiOf(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  const probe = `try { process.dlopen({ exports: {} }, ${JSON.stringify(file)}); console.log('node'); }
     catch (error) { console.log(/NODE_MODULE_VERSION/.test(error.message) ? 'other' : 'node'); }`;
  try {
    return execFileSync(process.execPath, ['-e', probe], { encoding: 'utf-8' }).trim() === 'node'
      ? 'node'
      : 'electron';
  } catch {
    return null;
  }
}

/**
 * Replaces the binary by rename, never by writing over it in place. A running
 * Electron app has this file mapped; overwriting its contents corrupts that
 * mapping and takes the process down. A rename gives the new build a new
 * inode and leaves anything already running attached to the old one.
 */
function swapIn(source) {
  const staging = `${BINARY}.incoming`;
  fs.copyFileSync(source, staging);
  fs.renameSync(staging, BINARY);
}

function rebuild(abi) {
  const command = abi === 'node'
    ? ['npm', ['rebuild', 'better-sqlite3']]
    : ['npx', ['electron-rebuild', '-m', '.', '-f', '-w', 'better-sqlite3']];
  execFileSync(command[0], command[1], { cwd: ROOT, stdio: 'inherit' });
}

if (abiOf(BINARY) === target) {
  process.exit(0);
}

// Keep whatever is there now, so switching back later costs a copy.
const current = abiOf(BINARY);
fs.mkdirSync(CACHE_DIR, { recursive: true });
if (current) {
  fs.copyFileSync(BINARY, cachedFor(current));
}

if (fs.existsSync(cachedFor(target))) {
  swapIn(cachedFor(target));
  process.exit(0);
}

rebuild(target);
if (abiOf(BINARY) === target) {
  fs.copyFileSync(BINARY, cachedFor(target));
}
