# ADR-003: SQLite driver and worker boundary

## Status
Partially decided (2026-07-12): driver selected and proven by the P0-A spike.
Migration tool, backup mechanism, and repository abstraction finalised in M2.

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
- **Migration tool and backup mechanism**: decided in M2 when the real
  schema (spec section 23.2) lands.

## Consequences
- Synchronous driver calls are acceptable because they never run on the
  Electron main thread or in the renderer — only in the storage worker.
- Each Electron upgrade requires a native-module rebuild and a re-run of the
  packaged P0-A check on every supported platform/architecture.
