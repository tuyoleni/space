# ADR-009: Release signing, auto-update, and telemetry policy

## Status
Accepted — resolved during M8 (Phase 7: automation and hardening)

## Context
Spec section 31: code signing, auto-update, and release channels. Spec section 29.2: an opt-in
telemetry policy with a hard boundary on what it may and may not carry. Spec section 39 prohibits
unsigned public releases. This milestone's hard safety boundary additionally prohibits using any
real code-signing certificate, any real Apple notarization, any real Windows code-signing
certificate, any real auto-update server, and any real telemetry/analytics backend — none of that
infrastructure is available to this implementation, and none of it should be faked into looking
real. This ADR records what was built anyway (real logic behind DI'd seams, fake-only in tests),
what remains unwired pending real infrastructure, and what the user must provision before any of
it can go live.

## Decision

**Code signing: required for any public release path, not weakened to accommodate what we don't
have.** `apps/desktop/forge.config.ts` has no signing configuration today (`osxSign`/
`osxNotarize`/Windows certificate) — packaging is unsigned. That is acceptable for local
development builds; it is not acceptable for anything distributed to a real user (spec 31.2,
spec 39). This milestone does not add a fake signing step or weaken the packaging pipeline to
pretend signing happened. What the user must provision before any public release build is made:
- **macOS**: an Apple Developer ID Application certificate and a notarization credential
  (an app-specific password or API key for `notarytool`), wired into `forge.config.ts`'s
  `osxSign`/`osxNotarize` options and Electron Forge's own signing/notarization flow.
- **Windows**: a trusted code-signing certificate (EV or OV) from a recognized CA, and a
  timestamping authority URL, wired into the Windows maker's signing configuration.
- Both secrets belong in CI secret storage only (spec 31.2), never committed to this repository —
  standing instruction, unchanged by this milestone.
- **macOS Gatekeeper/notarization testing is out of reach in this environment** — it requires a
  real signed, notarized build and a real Apple Developer account to observe Gatekeeper's actual
  verdict. Documented here as a deferred verification step, not attempted with a workaround (e.g.
  ad hoc self-signing) that would give a false sense of having proven it.

**Auto-update: a real, DI'd seam with no real feed behind it yet.** `@space/updater` implements
every piece of spec 31.3 that does not require an actual server to exist:
- `UpdateFeedPort` is the one boundary the package crosses to learn about a new version — injected,
  never a hard-coded URL. No implementation of it exists in this codebase that calls a real
  endpoint.
- `verifyUpdateArtifact` does real cryptographic verification (SHA-256 integrity plus RSA-SHA256
  signature verification via `node:crypto`) — tested end to end against an ephemeral keypair
  generated inside the test itself, never a real Space release key. A real deployment supplies a
  real public key (the matching private key lives in CI secret storage, signing artifacts at
  release time, mirroring the code-signing secrets above) and a real feed; this package does not
  need to change to accept either.
- `evaluateApplyGate` is the structural "never interrupt a running installation, Git mutation, or
  unrecoverable operation" check spec 31.3 requires, plus a stricter local rule: it also refuses to
  apply a new update while local database migrations are still pending from a previous update
  (`pendingLocalMigrationCount > 0`) — updating on top of an already-inconsistent local schema
  state would compound the problem rather than resolve it.
- `applyUserChoice` encodes defer/restart-later as an explicit state machine rather than an
  ad hoc boolean.
- None of this is wired into `main.ts` yet — there is nothing real to point `UpdateFeedPort` at.
  Wiring it is additive once a real update-hosting decision is made (a static signed-manifest host
  is the simplest option; Electron's own `autoUpdater`/Squirrel-based flow is the other realistic
  path, and `UpdateFeedPort` is deliberately shaped to sit in front of either).

**Rollback policy (spec 31.3: "app binary rollback may not imply database rollback").**
Space's SQLite migrations (`@space/storage`, ADR-003) are additive-only and forward-only by design
— every migration adds tables/columns, none of them are ever edited or reverted once shipped, and
there is no `down` migration concept anywhere in this codebase. The policy this implies:
- **Rolling back the app binary to an older version is safe to offer to a user** (reinstalling an
  older signed installer), because an older binary reading a newer database schema only fails to
  use the *new* tables/columns it doesn't know about — it does not corrupt them, since older code
  never issues `DROP`/`ALTER` against columns it doesn't recognize.
- **Rolling back the database schema itself is never attempted automatically.** There is no
  mechanism in this codebase that could safely undo an applied migration (data created under the
  new schema, e.g. a new `automations` table's rows, has no defined meaning to roll back to). If a
  user needs to recover from a bad update, the supported path is: restore the pre-update database
  backup `runMigrations`'s `backupDatabaseFile` already takes automatically before applying any
  pending migration (existing ADR-003 behaviour, not new to this milestone), then reinstall the
  matching older app version.
- Concretely: **app-binary rollback is supported; database-schema rollback is not, and a user
  downgrading the app after a schema-changing update should expect the new tables to sit unused
  until they upgrade again**, not to be silently dropped or migrated backwards.

**Release channels (spec 31.4).** `@space/updater`'s `ReleaseChannel` type defines the four
recommended channels (`internal`/`alpha`/`beta`/`stable`) as a closed union so a feed
implementation cannot invent a fifth. Spec 31.4's "a workspace database created by a newer channel
must not silently corrupt when opened by an older channel" is already satisfied structurally by
the same additive-migration policy above — there is nothing channel-specific in the migration
runner to get wrong.

**Telemetry: opt-in, default OFF, structurally constrained schema, no real backend.**
`@space/telemetry`'s event schema (`TelemetryEvent`) covers exactly spec 29.2's four allowed
categories (anonymous feature usage, performance timings, crash category, installer outcome by
tool/platform) and nothing else. Every field on every variant is a closed string-literal union, a
number, or an ISO timestamp — there is no `message: string`, `context: Record<string, unknown>`,
or similarly open field anywhere in the schema, which is what makes the six prohibited categories
(source code, commit messages, unsanitized file paths, terminal text, tokens/environment values,
private repo names without consent) structurally impossible to smuggle through, not just something
a reviewer has to trust every call site to avoid. `TelemetrySettings` defaults to `{ enabled: false
}`; `recordTelemetryEvent` is the one gated entry point every call site would use, and it is a
no-op unless a user has explicitly opted in (`AppSettingsRepository.isTelemetryEnabled`,
`app_settings` migration 0008, absent row = off). The renderer's telemetry checkbox
(`App.tsx`) is wired to this real, persisted setting today — flipping it has no visible network
effect yet, because `TelemetrySinkPort` has no real implementation in this codebase; only a
fake-only one exists, used in tests.

## Consequences
- Nobody using Space today gets automatic updates or telemetry of any kind — the opt-in checkbox
  exists and persists a real choice, but nothing is ever sent, because no real feed or backend is
  wired up. This is a deliberate scope boundary for M8, driven directly by this milestone's hard
  safety boundary (no real update server, no real telemetry backend), not an oversight.
- A public release of Space is blocked on the user provisioning real Apple/Windows signing
  credentials and wiring them into `forge.config.ts`; this repository will not produce a signed
  build on its own.
- Connecting a real `UpdateFeedPort` implementation later is additive (a new module implementing
  the interface, wired into `main.ts`, plus a real signing keypair for `verifyUpdateArtifact`) and
  does not require touching `apply-gate.ts` or `decision.ts`.
- Connecting a real `TelemetrySinkPort` implementation later is additive in the same way, and
  because `recordTelemetryEvent` already gates on the opt-in setting, a real sink can be wired in
  without re-auditing every call site for the opt-in check — it is enforced once, centrally.
- If a future milestone ever needs a true database-schema downgrade (not just an app-binary
  downgrade), that is a new capability this ADR explicitly says does not exist yet — it would need
  its own design, not an assumption that `runMigrations`'s existing backup file is sufficient for
  anything beyond a full restore.
