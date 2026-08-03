# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- space:mcp-context:start -->
Space workspace context: At the start of every coding session, call the Space MCP tool `get_project_context` with the absolute current working-directory path. If the working directory or codebase changes, call it again before using any other Space tool. Use only the workspace and project ID returned for that path; never reuse a project ID from another codebase.
<!-- space:mcp-context:end -->

## What this is

Space is a cross-platform (macOS + Windows) Electron desktop app that
orchestrates the real Git CLI, GitHub CLI (`gh`), package managers,
runtimes, and cloud CLIs through a coherent interface and an explicit
workspace context — it does not replace them.

## Source of truth

The implementation baseline is
[`docs/Space_Product_Engineering_Specification_v1.0.pdf`](docs/Space_Product_Engineering_Specification_v1.0.pdf),
plus the Architecture Decision Records in `docs/adr/`. The spec is
deliberately prescriptive (MUST/MUST NOT/SHOULD/MAY keywords) and governs
every product and engineering decision in this repo. **Where code, this
file, or the README disagree with the spec, the spec wins.** When a
change touches something the spec speaks to, check the relevant spec
section and the matching ADR before deciding an approach.

`docs/adr/` records decisions per spec section 40 (one ADR per open
decision point): build toolchain, GitHub multi-account credentials,
SQLite driver/worker boundary, installer orchestration, environment
inheritance, project trust, Git history indexing, model provider/privacy,
and release signing/updates/telemetry. Several ADRs describe what is
implemented vs. what remains an open verification gap (e.g. no real
installer or code-signing cert has been run/used) — read the ADR's
Status section before assuming a described behavior is live.

## Commands

```bash
npm install
npm run dev          # starts the Electron app (apps/desktop)
npm run lint         # eslint, apps/desktop only (--workspaces --if-present)
npm run typecheck    # tsc --noEmit across every workspace package
npm run test         # vitest run, repo-wide
npm run test:watch   # vitest watch mode
```

Running a single test or package's suite:

```bash
npx vitest run packages/git-engine/src/queue.test.ts   # one file
npx vitest run packages/security                       # one package's tests
npm run test --workspace=packages/domain                # a package's own `test` script
npx vitest run tests/integration/m5-git-handlers.test.ts # one integration test
```

Vitest picks up `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`,
and `tests/integration/**/*.test.ts` (see `vitest.config.ts`). Most
packages colocate `*.test.ts` next to the source file it tests.

Integration tests under `tests/integration/` run real `git` against
temporary repos and need a configured Git identity:

```bash
git config --global user.email "you@example.invalid"
git config --global user.name "Your Name"
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `lint` once on Linux,
then `test` on Ubuntu, macOS, and Windows (a meaningful part of the suite
shells out to real `git`, spawns real PTYs, and opens real SQLite files —
platform-specific behavior, hence the full matrix).

### better-sqlite3's dual ABI

`better-sqlite3` is a native module that must be built against two
different ABIs in this repo: Node's (for Vitest) and Electron's (for the
app). `scripts/use-native-abi.mjs` rebuilds and caches a binary per
target and swaps it in by copy, invoked automatically via `pretest` /
`predev` / `prestart` (`rebuild:node` / `rebuild:electron`). Don't call
`electron-rebuild` or `npm rebuild` directly — it will silently leave the
other runtime's binary broken (this is exactly the "test run made the
Electron app die with an unexplained SIGTRAP" failure mode the comment in
`package.json` describes). If native-module errors show up after
switching between `npm test` and `npm run dev`, rerun the matching
`rebuild:*` script rather than debugging the module itself.

## Repository layout

```
apps/desktop/              Electron app: src/main, src/preload.ts, src/renderer
packages/contracts/        IPC channel names, zod schemas, shared domain types, SpaceAPI surface
packages/domain/           Pure models and policies, no I/O
packages/workspace-runner/ Workspace Process Runner: environment construction and process execution
packages/git-engine/       Git commands, structured output parsers, per-repo operation queue, fixtures
packages/github-engine/    gh CLI adapter and GitHub domain models
packages/environment/      Tool registry, installers, workspace service adapters
packages/terminal/         PTY host and terminal protocol
packages/activity/         Event model and aggregation
packages/automation/       Triggers, conditions, actions
packages/agent/            Intent/change grouping, agent-action typing/validation, model-privacy policy
packages/storage/          SQLite repositories and versioned migrations
packages/security/         Credential store, IPC sender validation
packages/logging/          Structured logs, rotation/retention, support bundles
packages/updater/          Update-feed seam, signature verification, apply gate
packages/telemetry/        Opt-in (default OFF) event schema and sink seam
packages/ui/               Shared renderer components (presentation only, no IPC/business logic)
tests/{fixtures,integration,e2e}/
docs/{adr,threat-model,runbooks}/
```

Packages that execute native operations — `workspace-runner`,
`git-engine`, `github-engine`, `environment`, `terminal`, `storage`,
`security`, `logging` — **must never be imported into the renderer
bundle** (spec section 32). The renderer only ever talks to the main
process through the `SpaceAPI` surface exposed by the preload script.

## Process architecture

Space is a standard three-context Electron app with one deliberately
narrow bridge between them:

- **Main** (`apps/desktop/src/main.ts`, `apps/desktop/src/main/*`) owns a
  single trusted `BrowserWindow`. Every IPC handler in `main/ipc.ts`
  calls `assertIpcSender(event, trusted)` (from `@space/security`) before
  doing anything — the window's `webContentsId` and allowed origin
  prefixes are pinned once at window creation, so no other sender can
  ever reach a handler (spec 20.3, 22.1, 25.3.1).
- **Preload** (`apps/desktop/src/preload.ts`) exposes exactly the
  `SpaceAPI` object (defined in `@space/contracts`) via
  `contextBridge` — never raw `ipcRenderer`, never anything shaped like
  `runCommand(command: string)`. `terminal.subscribe` is the one
  exception to invoke/response: it's a push-only listener over the
  `terminal:event` channel, filtered by session id.
- **Renderer** (`apps/desktop/src/renderer.tsx`,
  `apps/desktop/src/renderer/**`) is a React app that only calls
  `window.spaceAPI.*`.

`IPC_CHANNELS` in `packages/contracts/src/channels.ts` is the full,
closed set of channels reachable from the renderer — a channel not
listed there cannot be registered in `main/ipc.ts`. Every handler in
`main/ipc.ts` follows the same shape: `assertIpcSender` first, then parse
the input with the matching zod schema from `@space/contracts`
(`*InputSchema`), then delegate to a `*Handlers` module (constructed in
`main.ts`, one per domain — `gitHandlers`, `githubHandlers`,
`terminalHandlers`, `agentHandlers`, `automationHandlers`, etc.). Some
handlers additionally fire automation triggers
(`fireAutomationTrigger`) after a mutation succeeds — this is
fire-and-forget with its own error boundary and must never fail or roll
back the mutation it follows.

Two subsystems run in Electron `utilityProcess` workers, not the main
process, and are reached through a request/response client class that
handles spawning, timeouts, and bounded-retry crash recovery:

- **Storage** (`apps/desktop/src/main/storage-worker.ts`, fronted by
  `storage-client.ts`'s `StorageClient`) — the only process that opens
  the SQLite database (ADR-003). The main process never touches the DB
  directly; every call crosses into the worker via `StorageClient.call`.
- **Terminal** (`apps/desktop/src/main/terminal-worker.ts`, fronted by
  `terminal-client.ts`'s `TerminalClient`) — hosts real PTYs
  (`node-pty`). `TerminalClient.subscribe(sessionId, listener)` fans a
  session's stream out to storage bookkeeping and to the renderer's
  `terminal:event` channel.

## Cross-cutting patterns worth knowing before changing code

- **Workspace scope hierarchy.** Nearly every domain operation is scoped
  by `workspaceId` and/or `projectId` (spec section 5) — a named
  workspace carries its own Git/GitHub identity and environment. When
  adding a handler or store method, check what scope existing sibling
  methods take before inventing a new shape.
- **Git operations are queued per repository.** `packages/git-engine/src/queue.ts`
  serializes Git commands against a given repo so concurrent UI actions
  (e.g. stage + status refresh) can't race the same working tree.
- **Git history uses an indexed cache, not `git log` on demand.**
  `HistoryStore` (`packages/git-engine/src/history/store.ts`) is the
  single owner of a repo's indexed commit list (ADR-007) and is built to
  stay responsive at 100k+ commits by rendering only the visible window
  and showing partial history before indexing finishes.
- **Project trust is a single flag, not a sandbox** (ADR-006). While a
  project is untrusted, Space must not run installs, lifecycle scripts,
  project binaries, or source shell files, and must not inject workspace
  secrets — this is enforced at the handler layer, not by OS-level
  isolation.
- **Agent/model-privacy policy** (spec 13.3/19.3, ADR-008): if a remote
  model is used, the user must be able to see which files/diff fragments
  are sent, secrets/sensitive values must be redacted, binaries are never
  sent by default, and raw credentials/env files/key material must never
  be sent. `@space/agent` treats local/rule-based intent grouping as the
  real default, not a degraded fallback.
- **Credentials never go through SQLite or plain JSON.** `@space/security`'s
  credential store wraps the OS keychain (macOS `security` CLI,
  Windows DPAPI via `keychain-credential-store.ts`) — there is no
  cross-platform fallback; an unsupported platform fails loudly rather
  than degrading to an insecure store.
- **Environment variable inheritance is allow/deny-listed**, following
  the precedence order OS base → machine tool paths → workspace tool
  paths/vars → project runtime/vars → secrets → operation-specific vars
  (spec 5.3, ADR-005) — host environment is not blindly inherited into
  spawned processes.

## Prohibited shortcuts (spec section 39)

- No `runAnyCommand`/generic shell IPC from the renderer, and no direct
  Node access from the renderer.
- No token or credential storage in SQLite or plain JSON.
- No rewriting global Git/GitHub config files on workspace switch.
- No running dependency installs before a project is granted trust.
- Do not treat workspace isolation as a malicious-code sandbox — it is
  identity/config isolation, not a security boundary against hostile
  code.
- Never use a real code-signing certificate, real Apple notarization,
  real Windows signing cert, real auto-update server, or real
  telemetry/analytics backend in this environment (ADR-009) — those
  seams are real but DI'd to fakes in tests; provisioning real
  infrastructure is a deployment-time decision for the user, not
  something to wire up here.

## Milestones

Built as vertical slices (spec 36/43), tracked as ordered milestones
mirroring the spec's phased programme — M0 scaffold, M1 technical
spikes, M2 secure app foundation, M3 computer bootstrap, M4
project/terminal foundation, M5 complete local Git, M6 GitHub workflow,
M7 intent/agent layer, M8 automation and hardening. Test file prefixes
(`m2-`, `m4-`, `m5-`, ... in `tests/integration/`) and comments in
`main/ipc.ts` (`// M5: Git`, `// M7: intent/agent layer`, ...) map
directly to this milestone numbering — use it to find where a feature's
tests and wiring live.
