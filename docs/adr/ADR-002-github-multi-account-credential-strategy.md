# ADR-002: GitHub multi-account credential strategy

## Status
Partially resolved (2026-07-12, M6). The spec 5.6 fallback design is
implemented and shipped regardless of spike outcome, per this ADR's own
original decision drivers. What remains open is empirical: the manual
two-account protocol in `docs/runbooks/p0b-github-multi-account-spike.md`
has not been run on either macOS or Windows, because it requires two real
GitHub accounts and a real `gh auth login`, both explicitly outside what
this milestone's implementer was permitted to do autonomously. This ADR
cannot be marked "Accepted" until a human operator runs that protocol.

## Context
Spec sections 5.6 and 40.2: `GH_CONFIG_DIR` isolates GitHub CLI
configuration files, but authentication tokens may still interact with
the shared OS credential store. Before GitHub multi-account support is
considered complete, a P0 spike must run with at least two GitHub
accounts on both macOS and Windows.

## Decision drivers
- `GH_CONFIG_DIR` per workspace, with a tested secure-token fallback when
  OS credential-store behaviour requires it.
- Store the workspace's GitHub token in the OS credential store under a
  Space-owned service/account identifier; store only the token
  *reference* in SQLite.
- Inject `GH_TOKEN` into the relevant process at runtime; never persist
  the raw token in SQLite or plain JSON (prohibited per section 39).
- Redact the token from logs, receipts, and crash reports.

## Findings so far (credential-free portion, macOS, gh 2.95.0)
- `GH_CONFIG_DIR` isolates gh configuration completely: per-root
  `config.yml`, no cross-root visibility, and the user's normal
  `~/.config/gh` is never created or modified.
- The open risk is exactly as the spec warns: whether `gh auth login`
  keys OS credential-store entries per config dir or collides across
  workspaces. This still cannot be tested without two real accounts and
  a real, interactive `gh auth login` — both outside what an autonomous
  coding session is permitted to do (see "What was not run" below).

## Decision
Implement the spec 5.6 fallback design unconditionally, as the spec
itself directs ("the implementation MUST support this fallback design"),
rather than waiting on the spike result. This resolves the practical
question — what does Space actually build — independently of the
still-open empirical question about `gh`'s own credential-store
behaviour.

**What was built (M6):**

1. **`GH_CONFIG_DIR` per workspace (Tier 1 isolation).** Every real `gh`
   invocation is scoped to a workspace-specific config directory
   (`apps/desktop/src/main/github-handlers.ts`'s `ghConfigDirFor`),
   exactly as the P0-B spike already verified is fully config-isolating.
2. **Space-owned OS credential store entries, one per (workspace, host).**
   `@space/security`'s `CredentialStorePort` (`credential-store.ts`) is
   the abstraction; `NodeKeychainCredentialStore`
   (`keychain-credential-store.ts`) is the real implementation — macOS
   via the `security` CLI (the established Keychain API, not
   `safeStorage`, per spec 24.1's "use established keychain/credential
   APIs where stronger semantics are required"), Windows via DPAPI
   through PowerShell (no single-command CLI exists for round-tripping
   an arbitrary secret through Credential Manager). The credential
   reference is deterministic and Space-owned:
   `buildGithubCredentialRef(workspaceId, host)` in
   `packages/github-engine/src/credential.ts` produces
   `{ service: "space.github", account: "<workspaceId>:<host>" }`.
3. **Reference-only SQLite.** Migration `0005_github` adds
   `service_connections` and `secret_refs` (spec 23.2.5/23.2.6, field-for-
   field). `secret_refs` has no column for a secret value, only
   `service_name`/`account_key` — the same two fields that address the
   credential store. Verified directly in
   `tests/integration/m6-github-handlers.test.ts` by reading the real
   database file's raw bytes and asserting the token string is absent.
4. **`GH_TOKEN` injected at runtime, scoped to one command.**
   `github-handlers.ts`'s `scopedGhExecutor`/`scopedGitExecutor` resolve
   the token from the credential store and merge `GH_TOKEN`/
   `GH_CONFIG_DIR` into only that one child process's environment — never
   into the general workspace environment policy
   (`environment-policy.ts`'s `buildSpaceEnvironment`, which
   deliberately denies `GH_TOKEN` by default for every other spawned
   process, e.g. shells and dev servers). `GitExecutor` and `GhExecutor`
   both gained an optional `env` field for exactly this purpose — `git`
   needs it too, since the `gh`-installed credential helper is a child of
   the `git` process, not of Space directly, and only inherits what
   git's own environment carries.
5. **Redaction.** The token is registered with a `RedactionRegistry`
   (`@space/workspace-runner`, already built in M4/M5 — reused, not
   duplicated) the instant it is read from the credential store, before
   any command runs. Every `gh`/`git` result's stdout/stderr is redacted
   through that registry before it can reach a receipt, an activity
   event, or a log. Verified in
   `tests/integration/m6-github-handlers.test.ts`.

**What was not run (and must not have been, per this milestone's explicit
boundary):** the manual two-account protocol itself. That requires real
`gh auth login` against two disposable GitHub accounts, which an
autonomous coding session is explicitly prohibited from initiating. The
credential store's real-keychain code path (`NodeKeychainCredentialStore`)
is therefore also unverified against a real keychain — it is tested only
against the injected `OsCredentialExecutor` fake
(`keychain-credential-store.test.ts`), which proves the arg-building and
control-flow logic but not real macOS Keychain or Windows DPAPI behaviour.
The Windows path additionally carries M3's standing caveat: written
correctly per this design, not executed on a Windows machine (none
available).

## Consequences
- Space does not depend on the spike's outcome to ship V1 credential
  handling: the fallback design is simply the design, always.
- If the eventual two-account run finds `GH_CONFIG_DIR` alone is
  sufficient (i.e. `gh` already keys credential-store entries per config
  dir with no collision), the OS-keychain fallback becomes redundant
  defence-in-depth rather than a strictly required layer — acceptable,
  since spec 24.1 asks for the OS credential store as the general secret-
  storage requirement independent of the multi-account question.
- If the run instead finds collision (the scenario spec 5.6 anticipates),
  no further implementation work is needed — the fallback is already
  built, tested against fakes, and wired into every credential-touching
  code path in `github-handlers.ts`.
- This ADR stays "Partially resolved," not "Accepted," until a human
  operator runs `docs/runbooks/p0b-github-multi-account-spike.md` on both
  macOS and Windows and records the actual collision/no-collision result
  here.
