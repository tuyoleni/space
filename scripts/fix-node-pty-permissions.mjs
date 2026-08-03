/**
 * node-pty ships prebuilt native binaries per platform/arch under
 * `node_modules/node-pty/prebuilds/<platform>-<arch>/`. On macOS/Linux,
 * every PTY spawn goes through `spawn-helper` — a real subprocess node-pty
 * execs before the target shell, not just a loaded library — so it must
 * keep its execute bit. Some install paths (tarball extraction on certain
 * filesystems, containers, CI cache restores) don't preserve that bit, and
 * the failure this produces is a generic, unhelpful `posix_spawnp failed`
 * on *every* terminal session — plain shells and `gh auth login` alike,
 * since both go through the same spawn path (packages/terminal/src/
 * node-pty-spawner.ts). Cheap to just re-assert on every install/dev/test
 * run rather than debug per-machine.
 */
import fs from 'node:fs';
import path from 'node:path';

const PREBUILDS_DIR = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');

if (fs.existsSync(PREBUILDS_DIR)) {
  for (const platformArch of fs.readdirSync(PREBUILDS_DIR)) {
    const spawnHelper = path.join(PREBUILDS_DIR, platformArch, 'spawn-helper');
    if (fs.existsSync(spawnHelper)) {
      fs.chmodSync(spawnHelper, 0o755);
    }
  }
}
