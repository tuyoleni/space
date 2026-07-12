/**
 * M4: real project creation (PRJ-004) and real dependency installation
 * (PRJ-005) against a throwaway temp directory — never this repository's
 * own node_modules/lockfiles, matching the milestone's "real but
 * sandboxed" testing bar. `npm init --yes` and `npm install` against a
 * dependency-free package.json both complete without any network access,
 * so this stays fast and hermetic.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from '@space/workspace-runner';
import { NODE_MINIMAL_TEMPLATE, detectPackageManager, installCommandFor, nodeProjectDetectionFs } from '@space/environment';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-m4-create-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const resolveOnPath = async (executableId: string) => executableId;

/** npm needs HOME (config/cache resolution) in addition to PATH to run at all. */
function testEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe('project creation via the node-minimal template (PRJ-004)', () => {
  it('runs the declared non-interactive creation command for real and produces the expected files', async () => {
    const target = path.join(dir, 'my-app');
    fs.mkdirSync(target);

    const command = NODE_MINIMAL_TEMPLATE.creationCommand({}, 'my-app');
    const receipt = await runProcess(
      {
        operationId: 'op-create-1',
        workspaceId: 'ws-1',
        executableId: command.executable,
        args: command.args,
        cwd: target,
        env: testEnv(),
      },
      { resolveExecutable: resolveOnPath },
    );

    expect(receipt.state).toBe('succeeded');
    for (const expectedFile of NODE_MINIMAL_TEMPLATE.expectedFiles) {
      expect(fs.existsSync(path.join(target, expectedFile))).toBe(true);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf-8')) as { name: string };
    // `npm init --yes` defaults the package name to the directory name.
    expect(pkg.name).toBe('my-app');
  });

  it('the verify command runs for real and succeeds against the created project', async () => {
    const target = path.join(dir, 'verify-app');
    fs.mkdirSync(target);
    const createCommand = NODE_MINIMAL_TEMPLATE.creationCommand({}, 'verify-app');
    await runProcess(
      {
        operationId: 'op-create-2',
        workspaceId: 'ws-1',
        executableId: createCommand.executable,
        args: createCommand.args,
        cwd: target,
        env: testEnv(),
      },
      { resolveExecutable: resolveOnPath },
    );

    const verify = NODE_MINIMAL_TEMPLATE.verifyCommand;
    const receipt = await runProcess(
      {
        operationId: 'op-verify-1',
        workspaceId: 'ws-1',
        executableId: verify.executable,
        args: verify.args,
        cwd: target,
        env: testEnv(),
      },
      { resolveExecutable: resolveOnPath },
    );
    expect(receipt.state).toBe('succeeded');
    expect(receipt.stdout.trim().replace(/"/g, '')).toBe('verify-app');
  });
});

describe('dependency installation respects the detected package manager (PRJ-005)', () => {
  it('detects npm from a real package-lock.json and installs for real without touching this repo', async () => {
    const target = path.join(dir, 'install-app');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'install-app', version: '1.0.0' }));

    const detection = await detectPackageManager(target, nodeProjectDetectionFs);
    expect(detection.resolution).toBe('none'); // no lockfile yet

    const install = installCommandFor('npm');
    const receipt = await runProcess(
      {
        operationId: 'op-install-1',
        workspaceId: 'ws-1',
        executableId: install.executable,
        args: [...install.args, '--no-audit', '--no-fund'],
        cwd: target,
        env: testEnv(),
        timeoutMs: 60_000,
      },
      { resolveExecutable: resolveOnPath },
    );

    expect(receipt.state).toBe('succeeded');
    expect(fs.existsSync(path.join(target, 'package-lock.json'))).toBe(true);

    const afterInstall = await detectPackageManager(target, nodeProjectDetectionFs);
    expect(afterInstall.resolution).toBe('single');
    expect(afterInstall.packageManager).toBe('npm');
  }, 30000);

  it('refuses to guess when incompatible lockfiles coexist', async () => {
    const target = path.join(dir, 'conflict-app');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(target, 'yarn.lock'), '');

    const detection = await detectPackageManager(target, nodeProjectDetectionFs);
    expect(detection.resolution).toBe('conflict');
    expect(detection.packageManager).toBeNull();
  });
});
