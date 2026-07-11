# ADR-003: SQLite driver and worker boundary

## Status
Pending — resolved during M1 (Phase 1: secure application foundation)

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
_To be filled in during M1 implementation._

## Consequences
_Pending._
