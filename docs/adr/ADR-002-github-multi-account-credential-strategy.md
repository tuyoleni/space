# ADR-002: GitHub multi-account credential strategy

## Status
Pending — resolved after the P0-B technical spike (M1)

## Context
Spec sections 5.6 and 40.2: `GH_CONFIG_DIR` isolates GitHub CLI configuration files, but
authentication tokens may still interact with the shared OS credential store. Before
GitHub multi-account support is considered complete, a P0 spike must run with at least two
GitHub accounts on both macOS and Windows.

## Decision drivers
- `GH_CONFIG_DIR` per workspace, with a tested secure-token fallback when OS credential-store
  behaviour requires it.
- Store the workspace's GitHub token in the OS credential store under a Space-owned
  service/account identifier; store only the token *reference* in SQLite.
- Inject `GH_TOKEN` into the relevant process at runtime; never persist the raw token in
  SQLite or plain JSON (prohibited per section 39).
- Redact the token from logs, receipts, and crash reports.

## Decision
_To be filled in after the P0-B spike completes on both platforms (task M1)._

## Consequences
_Pending._
