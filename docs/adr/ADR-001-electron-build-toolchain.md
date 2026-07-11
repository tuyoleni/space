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

## Consequences
- No libgit2 or second repository engine is introduced (section 11.1) — the system `git`
  executable remains the single source of truth.
- Renderer code is built independently of main/preload and must not import Node core modules
  (enforced by lint rule + package boundaries, section 33).
- Packages that execute native operations (`workspace-runner`, `git-engine`, `github-engine`,
  `environment`, `terminal`, `storage`, `security`) are never imported into the renderer bundle.
