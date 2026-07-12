import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs/promises';
import path from 'node:path';

// npm workspaces hoist dependencies to the monorepo root, so apps/desktop
// has no local node_modules for the packager to copy. These native
// packages (and their runtime-only dependency closure) must be copied in
// explicitly before asar creation, or the packaged app has no .node
// binaries at all (found and fixed during the P0-A spike, section 36.1.1).
// ADR-001 tracks this as the interim strategy; a monorepo-aware packaging
// tool may replace it later.
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ONLY_PACKAGES = ['better-sqlite3', 'node-pty'];

async function resolveRuntimeClosure(roots: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pkg = queue.shift();
    if (pkg === undefined || seen.has(pkg)) {
      continue;
    }
    seen.add(pkg);
    const manifestPath = path.join(WORKSPACE_ROOT, 'node_modules', pkg, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    queue.push(...Object.keys(manifest.dependencies ?? {}));
  }
  return [...seen];
}

async function copyHoistedRuntimeDependencies(buildPath: string): Promise<void> {
  const targetNodeModules = path.join(buildPath, 'node_modules');
  await fs.mkdir(targetNodeModules, { recursive: true });
  for (const pkg of await resolveRuntimeClosure(RUNTIME_ONLY_PACKAGES)) {
    const source = path.join(WORKSPACE_ROOT, 'node_modules', pkg);
    const destination = path.join(targetNodeModules, pkg);
    try {
      await fs.cp(source, destination, { recursive: true, dereference: true });
    } catch (error) {
      throw new Error(`Failed to copy hoisted runtime dependency "${pkg}" into packaged app: ${String(error)}`);
    }
  }
  // node-pty's macOS spawn-helper is a plain executable, not a .node file;
  // npm does not preserve its exec bit in prebuilds, and without it every
  // pty.spawn fails with "posix_spawnp failed" (found in the P0-A spike).
  const helperCandidates = [
    path.join(targetNodeModules, 'node-pty', 'build', 'Release', 'spawn-helper'),
    path.join(targetNodeModules, 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
    path.join(targetNodeModules, 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
  ];
  for (const helper of helperCandidates) {
    await fs.chmod(helper, 0o755).catch(() => undefined);
  }
}

// Target platforms are macOS and Windows only (spec section 3.6: Linux
// desktop is a non-goal for the first production release).
const config: ForgeConfig = {
  packagerConfig: {
    // Unpack the native packages wholesale: node-pty needs its spawn-helper
    // executable (not a .node file) runnable from the real filesystem, which
    // the auto-unpack-natives plugin's *.node-only glob does not cover.
    asar: {
      unpack: '**/node_modules/{node-pty,better-sqlite3}/**',
    },
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        copyHoistedRuntimeDependencies(buildPath).then(
          () => callback(),
          (error) => callback(error instanceof Error ? error : new Error(String(error))),
        );
      },
    ],
  },
  rebuildConfig: {},
  makers: [new MakerSquirrel({}), new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          // P0-A technical spike worker (spec section 36.1.1): runs as a
          // real Electron utility process, not bundled into main/preload.
          entry: 'src/spikes/p0a-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          // Storage worker (ADR-003, spec sections 20.2.4, 23.1): the only
          // process that opens SQLite. Runs as a real utility process, not
          // bundled into main/preload.
          entry: 'src/main/storage-worker.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
