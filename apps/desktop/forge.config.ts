import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { rebuild } from '@electron/rebuild';
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

function removeRuntimeBrandIcon(
  buildPath: string,
  _electronVersion: string,
  platform: NodeJS.Platform,
  _arch: string,
  callback: (error?: Error | null) => void,
): void {
  if (platform !== 'darwin') {
    callback();
    return;
  }

  // The packaging runtime begins as Electron.app. Remove only its default
  // icon before packager copies the Space icon declared below and signs the
  // final bundle. Runtime binaries remain untouched.
  fs.rm(path.join(buildPath, 'Electron.app', 'Contents', 'Resources', 'electron.icns'), { force: true }).then(
    () => callback(),
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
  );
}

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

async function copyHoistedRuntimeDependencies(
  buildPath: string,
  electronVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<void> {
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
  // The copy above is whatever `npm install` produced on the *host* — right
  // for a same-arch build, wrong the moment `--arch` cross-targets a CPU
  // different from the CI runner (e.g. packaging x64 from an Apple Silicon
  // runner, since GitHub no longer offers Intel-hosted macOS runners). Both
  // packages ship prebuilt binaries for darwin-x64/-arm64, so rebuild here
  // just re-fetches the correct prebuild for the packaged app's real target
  // instead of shipping host-arch .node files inside an other-arch app.
  await rebuild({
    buildPath,
    electronVersion,
    platform,
    arch,
    onlyModules: RUNTIME_ONLY_PACKAGES,
    force: true,
  });
  // Keep only the files these packages load at runtime. Rebuild leaves behind
  // architecture-specific `bin` folders, Makefiles, object metadata, and a
  // second set of prebuilds. Those are redundant once `build/Release` exists,
  // and their differing paths/content prevent @electron/universal from
  // combining the two app slices deterministically.
  if (platform === 'darwin') {
    const runtimeFiles = [
      {
        packageName: 'better-sqlite3',
        files: ['better_sqlite3.node'],
      },
      {
        packageName: 'node-pty',
        files: ['pty.node', 'spawn-helper'],
      },
    ];

    for (const runtimePackage of runtimeFiles) {
      const packageRoot = path.join(targetNodeModules, runtimePackage.packageName);
      const releaseDir = path.join(packageRoot, 'build', 'Release');
      const preserved = await Promise.all(
        runtimePackage.files.map(async (file) => {
          const source = path.join(releaseDir, file);
          return {
            file,
            contents: await fs.readFile(source),
            mode: (await fs.stat(source)).mode,
          };
        }),
      );

      await fs.rm(path.join(packageRoot, 'build'), { recursive: true, force: true });
      await fs.rm(path.join(packageRoot, 'bin'), { recursive: true, force: true });
      await fs.rm(path.join(packageRoot, 'prebuilds'), { recursive: true, force: true });
      await fs.rm(path.join(packageRoot, 'node-addon-api'), { recursive: true, force: true });
      await fs.mkdir(releaseDir, { recursive: true });

      for (const file of preserved) {
        const destination = path.join(releaseDir, file.file);
        await fs.writeFile(destination, file.contents);
        await fs.chmod(destination, file.mode);
      }
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

/**
 * macOS code signing.
 *
 * electron-packager rewrites Info.plist (product name, bundle id, icon)
 * *after* Electron's own ad-hoc signature, which breaks the bundle seal.
 * Shipping without re-signing produced an app whose signature failed
 * verification outright ("invalid Info.plist (plist or signature have been
 * modified)"), so Gatekeeper refused a downloaded copy with "damaged and
 * can't be opened" — the dead-end dialog with no "Open Anyway" escape — and
 * the framework/executable Team ID mismatch stopped some builds from
 * launching locally at all.
 *
 * With SPACE_APPLE_IDENTITY set (a "Developer ID Application" certificate in
 * the keychain) this produces a hardened-runtime build ready to notarize.
 * Without it, everything is re-signed ad-hoc: still not notarized, but the
 * seal is valid, so users get the recoverable "unidentified developer"
 * warning instead of a bundle macOS calls corrupt.
 */
const APPLE_IDENTITY = process.env.SPACE_APPLE_IDENTITY ?? '-';
const HAS_DEVELOPER_ID = APPLE_IDENTITY !== '-';

const osxSign = {
  identity: APPLE_IDENTITY,
  optionsForFile: () => ({
    ...(HAS_DEVELOPER_ID ? { entitlements: path.join(__dirname, 'entitlements.plist') } : {}),
    hardenedRuntime: HAS_DEVELOPER_ID,
  }),
};

/**
 * The Team ID notarytool submits under.
 *
 * Taken from SPACE_APPLE_TEAM_ID, or parsed out of the identity string, which
 * always ends in the team's ID in parentheses ("Developer ID Application:
 * Name (ABCDE12345)"). Only the app-specific-password path needs it; the API
 * key carries its own issuer.
 */
const APPLE_TEAM_ID = process.env.SPACE_APPLE_TEAM_ID ?? /\(([A-Z0-9]+)\)\s*$/.exec(APPLE_IDENTITY)?.[1];

/**
 * Notarization credentials, in either of the two shapes notarytool accepts.
 *
 * An App Store Connect API key (.p8 + key id + issuer) is preferred: it is
 * scoped to notarization, revocable on its own, and carries no account
 * password. An Apple ID plus app-specific password is the fallback for when
 * issuing an API key isn't possible — it needs the Team ID explicitly,
 * because the credential alone doesn't say which team to submit under.
 *
 * Ad-hoc builds skip notarization entirely; they have nothing Apple would
 * accept.
 */
const osxNotarize = ((): NonNullable<ForgeConfig['packagerConfig']>['osxNotarize'] => {
  if (!HAS_DEVELOPER_ID) return undefined;

  if (process.env.SPACE_APPLE_API_KEY) {
    return {
      appleApiKey: process.env.SPACE_APPLE_API_KEY,
      appleApiKeyId: process.env.SPACE_APPLE_API_KEY_ID ?? '',
      appleApiIssuer: process.env.SPACE_APPLE_API_ISSUER ?? '',
    };
  }

  if (process.env.SPACE_APPLE_ID && process.env.SPACE_APPLE_APP_PASSWORD) {
    if (!APPLE_TEAM_ID) {
      throw new Error(
        'Notarizing with an app-specific password needs a Team ID: set SPACE_APPLE_TEAM_ID, or use a SPACE_APPLE_IDENTITY that ends in "(TEAMID)".',
      );
    }
    return {
      appleId: process.env.SPACE_APPLE_ID,
      appleIdPassword: process.env.SPACE_APPLE_APP_PASSWORD,
      teamId: APPLE_TEAM_ID,
    };
  }

  return undefined;
})();

// Target platforms are macOS and Windows only (spec section 3.6: Linux
// desktop is a non-goal for the first production release).
const config: ForgeConfig = {
  packagerConfig: {
    // Without this the bundle id defaults to Electron's own, which left the
    // cask's `zap` stanza deleting preferences under a domain the app never
    // wrote to.
    appBundleId: 'com.tuyoleni.space',
    ...(process.platform === 'darwin' ? { osxSign } : {}),
    ...(osxNotarize ? { osxNotarize } : {}),
    // electron-packager appends the right extension per platform itself
    // (.icns on darwin, .ico on win32) when given an extension-less path —
    // both files live at assets/icons/icon.{icns,ico}.
    icon: path.join(__dirname, 'assets', 'icons', 'icon'),
    // Electron Packager otherwise writes the correct artwork under its
    // framework filename. Give the bundled asset a Space-owned name too.
    extendInfo: { CFBundleIconFile: 'icon.icns' },
    // Unpack the native packages wholesale: node-pty needs its spawn-helper
    // executable (not a .node file) runnable from the real filesystem, which
    // the auto-unpack-natives plugin's *.node-only glob does not cover.
    asar: {
      unpack: '**/node_modules/{node-pty,better-sqlite3}/**',
    },
    afterCopy: [
      (buildPath, electronVersion, platform, arch, callback) => {
        copyHoistedRuntimeDependencies(buildPath, electronVersion, platform, arch).then(
          () => callback(),
          (error) => callback(error instanceof Error ? error : new Error(String(error))),
        );
      },
    ],
    afterExtract: [removeRuntimeBrandIcon],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: path.join(__dirname, 'assets', 'icons', 'icon.ico') }),
    new MakerDMG(
      {
        name: 'Space',
        background: path.join(__dirname, 'assets', 'dmg', 'dmg-background.png'),
        icon: path.join(__dirname, 'assets', 'icons', 'icon.icns'),
        iconSize: 128,
        contents: (options) => [
          { x: 448, y: 205, type: 'link', path: '/Applications' },
          { x: 192, y: 205, type: 'file', path: options.appPath },
        ],
        format: 'ULFO',
        overwrite: true,
        additionalDMGOptions: {
          'background-color': '#f6f5f2',
          window: {
            size: { width: 640, height: 400 },
          },
        },
      },
      ['darwin'],
    ),
    // Keep ZIPs for Squirrel.Mac auto-update compatibility. Public download
    // links point to the DMGs instead.
    new MakerZIP({}, ['darwin']),
  ],
  hooks: {
    postPackage: async (_forgeConfig, options) => {
      if (process.platform !== 'darwin') return;
      const appPath = path.join(options.outputPaths[0], 'Space.app');
      const resourcesDir = path.join(appPath, 'Contents', 'Resources');
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs/promises');

      // codesign --deep does NOT traverse into .asar.unpacked/ directories.
      // Every Mach-O executable and .node bundle in those unpacked directories
      // must be signed individually BEFORE the top-level bundle is signed,
      // because macOS 27 validates code signatures on every spawned binary
      // (spawn-helper, pty.node dlopen targets, better_sqlite3.node, etc.)
      // and kills processes that try to execute improperly signed code.
      const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith('.asar.unpacked')) continue;
        const unpackedRoot = path.join(resourcesDir, entry.name);
        // `file` on universal binaries emits extra lines like
        // "pty.node (for architecture x86_64): Mach-O ..." — filter those
        // out with grep -v to avoid codesign failures on non-existent paths.
        const result = execSync(
          `find "${unpackedRoot}" -type f -exec file {} \\; | grep "Mach-O" | grep -v "(for architecture" | cut -d: -f1`,
          { encoding: 'utf-8' },
        );
        for (const filePath of result.trim().split('\n').filter(Boolean)) {
          execSync(`codesign --force --sign - "${filePath}"`, { stdio: 'inherit' });
        }
      }

      // node-pty's unixTerminal.js hardcodes:
      //   helperPath.replace('app.asar', 'app.asar.unpacked')
      // to remount spawn-helper from the asar virtual FS to the real
      // filesystem. @electron/universal names the arch-specific asars
      // `app-arm64.asar` / `app-x64.asar`, so the replacement never
      // matches and spawn-helper stays at an unresolvable asar path —
      // posix_spawnp then fails silently or crashes the worker.
      //
      // HOWEVER: when node-pty is fully unpacked (asar.unpack glob),
      // __dirname already points to the .asar.unpacked directory, so the
      // spawn-helper path is already correct on disk. The original
      // replace('app.asar', 'app.asar.unpacked') is a no-op in this case.
      // We only need to patch when the path still contains an asar
      // reference that wasn't unpacked — i.e., the .asar extension
      // without '.unpacked' already appended.
      const patchResult = execSync(
        `find "${resourcesDir}" -name unixTerminal.js -path "*.asar.unpacked*"`,
        { encoding: 'utf-8' },
      );
      for (const utPath of patchResult.trim().split('\n').filter(Boolean)) {
        const content = await fs.readFile(utPath, 'utf-8');
        if (content.includes('app-arm64.asar')) continue; // already patched
        // Only patch if the path is inside an asar (not already unpacked).
        // The negative lookahead (?!.*\.unpacked) prevents double-unpacking
        // when __dirname already points to .asar.unpacked.
        const patched = content.replace(
          "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
          [
            "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
            "// @electron/universal names the asar app-{arch}.asar — extend the remap",
            "if (helperPath.indexOf('.asar.unpacked') === -1) {",
            "  helperPath = helperPath.replace(/app\\-[a-z0-9]+\\.asar/g, function(m){ return m + '.unpacked'; });",
            "}",
          ].join('\n'),
        );
        if (patched !== content) {
          await fs.writeFile(utPath, patched);
        }
      }

      // Re-sign the top-level bundle ad-hoc (repairs the seal broken by
      // Info.plist rewriting in electron-packager's afterCopy).
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    },
  },
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
        {
          // Terminal/PTY worker (spec sections 15, 20.2.4): the only
          // process that owns a real PTY. Runs as a real utility process,
          // separate from storage per section 20.2.4's logical-service list.
          entry: 'src/main/terminal-worker.ts',
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
