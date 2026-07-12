# ADR-001: Electron build and package toolchain

## Status
Accepted (2026-07-11)

## Context
Spec section 40.1 requires deciding the exact Electron major, Forge/Vite configuration,
native module rebuild strategy, and workspace package manager before foundation work begins.

## Decision
- **Package manager**: npm workspaces (root `package.json` with `workspaces`), matching the
  `space/apps/*` and `space/packages/*` layout in section 32.
- **Framework**: Electron, pinned to an exact tested version (updated at each release per
  section 20.1). Current pin recorded in `apps/desktop/package.json`.
- **Language**: TypeScript, strict mode, across all packages and the app.
- **Renderer build**: Vite, via the official `@electron-forge/plugin-vite` integration
  (`create-electron-app --template=vite-typescript`).
- **Packaging**: Electron Forge (makers + publishers) for macOS (zip/dmg) and Windows (squirrel/zip),
  with code signing per section 31.2.
- **Native modules** (`better-sqlite3`, `node-pty`): rebuilt per-target by Electron Forge's
  native rebuild step (`@electron/rebuild`), verified for both platform/architecture
  combinations in CI before packaging (see M1/P0-A exit criteria).

## P0-A spike findings (2026-07-12, macOS arm64, Electron 43.1.0)

The packaged-app spike (spec section 36.1.1) passed after three fixes, all now
encoded in `apps/desktop/forge.config.ts` and `vite.main.config.ts`:

1. **Native modules must stay external to the Vite main-process bundle.**
   Rollup cannot inline the dynamic `require()` paths used by `node-pty` and
   `better-sqlite3` to locate their `.node` binaries. Both are declared in
   `build.rollupOptions.external` and resolved from `node_modules` at runtime.
2. **npm workspace hoisting breaks default packaging.** `apps/desktop` has no
   local `node_modules`, so `@electron/packager` copies no dependencies. An
   `afterCopy` hook resolves the runtime dependency closure (recursively via
   each package's `dependencies`) from the workspace root and copies it into
   the build. Interim strategy; revisit if a monorepo-aware packaging step is
   adopted.
3. **node-pty needs more than `.node` unpacking.** Its macOS `spawn-helper` is
   a plain executable; npm strips the exec bit in prebuilds and the
   auto-unpack-natives plugin's `*.node` glob leaves it inside the asar, which
   fails every spawn with `posix_spawnp failed`. Fixed with a custom
   `asar.unpack` glob covering the whole `node-pty`/`better-sqlite3` trees
   plus an explicit `chmod 755` on `spawn-helper` in the `afterCopy` hook.

Verified in the packaged app: SQLite WAL write/read roundtrip, real zsh PTY
spawn with output, utility-process crash detection and successful respawn.
**Windows remains unverified** — ConPTY, squirrel packaging, and the same
spike must be run on real Windows hardware before the platform is claimed
(spec section 34.6).

## Consequences
- No libgit2 or second repository engine is introduced (section 11.1) — the system `git`
  executable remains the single source of truth.
- Renderer code is built independently of main/preload and must not import Node core modules
  (enforced by lint rule + package boundaries, section 33).
- Packages that execute native operations (`workspace-runner`, `git-engine`, `github-engine`,
  `environment`, `terminal`, `storage`, `security`) are never imported into the renderer bundle.
