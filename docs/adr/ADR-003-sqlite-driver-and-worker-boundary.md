# ADR-003: SQLite driver and worker boundary

## Status
Decided (2026-07-12): driver selected and proven by the P0-A spike. Migration
tool, backup mechanism, repository abstraction, and the real storage worker
(replacing the P0-A spike worker) landed in M2.

## Context
Spec section 40.3: decide the SQLite driver, migration tool, backup mechanism, and native-module
packaging. Section 23.1 requires SQLite behind a repository/data-access abstraction, with native
modules running in worker processes, rebuilt and tested for each Electron platform/architecture.

## Decision drivers
- Driver must support synchronous or well-batched access from a dedicated storage/worker
  process only — never from the renderer or React hooks (section 33).
- Versioned, tested migrations must run before any service starts using the database
  (section 23.3).
- Backups must be created before destructive migrations.
- A failed migration must block mutation operations and show recovery instructions.

## Decision
- **Driver: `better-sqlite3`** (currently ^12.x), chosen for its synchronous,
  transaction-friendly API that fits a single dedicated storage worker, and
  proven working inside an Electron `utilityProcess` in both dev and packaged
  builds by the P0-A spike (WAL mode, write/read roundtrip verified on
  macOS arm64 / Electron 43.1.0).
- **Process boundary**: the database is opened only inside a privileged
  worker process (`utilityProcess`); the renderer reaches data exclusively
  through typed IPC. This boundary was exercised directly by the spike.
- **Native packaging**: `better-sqlite3` is external to the Vite bundle,
  copied into the packaged app with its dependency closure, and unpacked
  from asar — see ADR-001 P0-A findings for the exact mechanism.
- **Migration tool**: a small versioned-migration runner in `@space/storage`
  (`runMigrations`, `packages/storage/src/migrations.ts`) — no third-party
  migration framework. Each migration is a single SQL string with a
  monotonic integer version, tracked in a `schema_migrations` table, applied
  inside its own transaction, in order, before any repository is used.
- **Backup mechanism**: `backupDatabaseFile` copies the database file (and
  WAL/SHM siblings) to `<path>.backup-<timestamp>` before any pending
  migration is applied to an existing database file.
- **Real storage worker**: `apps/desktop/src/main/storage-worker.ts`
  (`utilityProcess.fork`, request/response protocol in
  `storage-protocol.ts`) supersedes the P0-A spike worker for all
  workspace/project storage access. `StorageClient` in the main process owns
  its lifecycle, including bounded crash-respawn.

## Consequences
- Synchronous driver calls are acceptable because they never run on the
  Electron main thread or in the renderer — only in the storage worker.
- Each Electron upgrade requires a native-module rebuild and a re-run of the
  packaged P0-A check on every supported platform/architecture.
- `better-sqlite3`'s native binding is ABI-specific to whichever Node
  runtime loads it. Because npm workspaces hoist it to one shared
  `node_modules`, the same binary cannot simultaneously serve both the
  plain-Node process running `vitest` and Electron's embedded Node running
  the storage worker — whichever ran last "wins" the binding until the other
  context rebuilds it. `npm test` and `npm run dev`/`start` each rebuild the
  binding for their own target automatically (`pretest` → `rebuild:node`,
  `predev`/`prestart` → `rebuild:electron`, both in the root
  `package.json`); running either check via a bypassed script (e.g.
  `npx vitest` directly) skips that rebuild and may fail with an
  `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch.
