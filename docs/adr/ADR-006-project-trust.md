# ADR-006: Project trust

## Status
Decided (2026-07-12): resolved during M4 (Phase 3: project and terminal foundation).

## Context
Spec section 40.6: define trusted-path rules, downloaded-file indicators, script permissions,
secret access, and re-prompt conditions. Section 10.3 requires newly cloned, downloaded, or
unfamiliar projects to start untrusted, and while untrusted, Space must not run package
installation, lifecycle scripts, project binaries, source shell files, load arbitrary Electron
content, or inject workspace secrets.

## Decision

### Trust is a single per-project flag, not a sandbox
`projects.trust_state` (`'untrusted' | 'trusted'`, spec section 23.2.2, added in M2) remains the
only persisted trust column — no separate "downloaded" or "reviewed" flag was added. Every
project starts `untrusted` at creation, with no exception for projects Space itself just
generated from a built-in template (see "Judgment call: self-created projects" below).

### The gate is structural, not a convention
`@space/domain`'s `checkTrust`/`assertTrusted` (`packages/domain/src/trust.ts`) is a pure
function every privileged call site must route through before it does anything. It is not
something callers are trusted to remember to call — `installDependencies` and `startDevServer`
in `apps/desktop/src/main/project-handlers.ts` call `assertTrusted` as the *first* thing they do,
before any process is spawned, and the M4 integration tests
(`tests/integration/m4-project-handlers.test.ts`) assert that an untrusted project's
`node_modules` directory is never created when installation is attempted without permission.

The six gated operation kinds mirror spec 10.3's list exactly:
`package-install`, `lifecycle-script`, `project-binary`, `source-shell-file`,
`load-project-content`, `inject-secrets`. M4 wires two of these end to end
(`package-install` for dependency installation, `lifecycle-script` for the dev-server launch,
since running `npm run dev` is running a project-defined script exactly like a lifecycle hook);
`project-binary`, `source-shell-file`, `load-project-content`, and `inject-secrets` are modelled
in the type but have no concrete call site yet because M4 does not implement running an arbitrary
project binary, sourcing a project's shell rc file, loading project HTML in a webview, or
workspace-secret injection at all — those land with the features that actually need them
(secret injection with GitHub/cloud auth in a later phase, project binaries alongside richer run
configurations). The gate exists now so nothing added later can skip it by accident: every new
call site is required to declare which `GatedOperationKind` it is and pass through
`assertTrusted`.

### Trusted-path rules
There is no "trusted path" allow-list (e.g. "projects under `~/Developer` are trusted by
default"). Location on disk is not a trust signal in this design: a malicious repository cloned
into a normally-safe directory is exactly as dangerous as one cloned anywhere else, and
special-casing paths would silently reintroduce a bypass. The only two ways a project becomes
trusted are:
1. A project-add/create/clone flow always inserts `trust_state = 'untrusted'`
   (`packages/storage/src/repositories/project-repository.ts`'s `create` hard-codes the SQL
   default; there is no code path that inserts a project as `'trusted'`).
2. An explicit user decision through `project.trustDecision`
   (`apps/desktop/src/main/storage-handlers.ts`), which is the only write path to
   `trust_state` after creation (`ProjectRepository.updateTrustState`).

### Downloaded-file indicators
Space does not currently set the macOS/Windows "quarantine"/"mark of the web" attribute itself
(projects arrive via `git clone` or the OS file system, not a browser download Space controls),
so ADR-006 does not define a mapping from that OS-level flag to `trust_state` in M4. If a later
milestone adds downloading arbitrary archives (e.g. GitHub release assets), the OS download
attribute should be treated as one more "start untrusted" trigger, but that is out of scope here
— every project already starts untrusted regardless of provenance, which is a strictly stronger
default than gating only on a download flag.

### Script permissions
"Trust this project" is all-or-nothing for the six gated operation kinds above; there is no
per-script allow-list (e.g. "allow `npm run build` but not `npm run postinstall`"). A narrower
per-script model was considered and rejected for M4: lifecycle scripts triggered transitively by
`npm install` (e.g. a dependency's own `postinstall`) are not enumerable up front, so a per-script
allow-list would create a false sense of granularity while the actual risk (arbitrary code
execution during install) is unchanged. Spec 25.3.3 additionally requires "show executable
scripts before first run" — full support for that surface (rendering a project's declared
scripts and their bodies to the user before the first trust decision) is left as follow-up UI
work; the structural gate does not depend on it being built first.

### Secret access
`inject-secrets` is a defined `GatedOperationKind` but M4 has no workspace-secret store to inject
from yet (that lands with GitHub/cloud credential handling in a later phase). Defence in depth
already exists at the environment-construction layer independent of trust:
`apps/desktop/src/main/environment-policy.ts`'s `SPACE_ENVIRONMENT_POLICY` denies a fixed list of
secret-shaped host environment variable names (`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, etc.) for
every process Space spawns, trusted or not — trust governs whether Space *adds* workspace secrets
to a project's environment, not whether ambient host secrets leak through.

### Re-prompt conditions
Trust decisions are per-project and durable — trusting a project does not expire, and a
`'trusted'` project's canonical path or Git remote changing does not automatically revert it to
`'untrusted'` in M4 (there is no remote-URL-change or filesystem-identity-change detector wired
up). This is a deliberate scope cut, not a considered permanent stance: WS-005 (project ownership)
already re-prompts when the *same path* is registered in a second workspace, and a natural
extension — re-prompting when a trusted project's Git remote is force-changed to an unrecognised
URL, or when its filesystem identity (dev/inode) changes underneath a stable path — is flagged
here as follow-up work for whichever milestone adds richer remote/identity tracking, rather than
implemented speculatively now.

### Trust choices
The three choices spec 10.3 requires are modelled as `TrustDecision =
'allow-once' | 'trust-this-project' | 'keep-untrusted'`
(`packages/domain/src/trust.ts`, `applyTrustDecision`):
- **`trust-this-project`** persists `trust_state = 'trusted'`.
- **`keep-untrusted`** and **`allow-once`** both leave the persisted state untouched.
  `allow-once` is never written to storage at all — it is a boolean the *caller* passes for a
  single already-confirmed operation (`assertTrusted({ ..., allowOnce: true })`), scoped to that
  one function call. There is no "remember allow-once for this session" state; a second gated
  operation on the same still-untrusted project requires a fresh confirmation. This was a
  deliberate simplification versus e.g. a session-scoped allow-once cache: it trades a small
  amount of extra user friction (re-confirming a second install in the same session) for a
  strictly simpler, more auditable model with no hidden expiry logic to get wrong.

Every trust decision — including `keep-untrusted` and a no-op `allow-once` — is recorded as an
`operations` receipt (`type: 'project.trustDecision'`) even when it does not change persisted
state, because the decision itself is a security-relevant, user-initiated event worth an audit
trail independent of whether it altered the database row.

### Judgment call: self-created projects
A project created via `project.createFromTemplate` (PRJ-004) still starts `'untrusted'`, even
though Space itself just ran the (vetted, built-in) creation command and no foreign code was
introduced. This reads slightly stricter than strictly necessary — the spec's literal language
("newly cloned, downloaded, or unfamiliar projects start as untrusted") could be read to exempt a
just-created, Space-authored project — but a single universal invariant ("every project row is
untrusted until a human explicitly trusts it") is simpler to reason about and audit than a
two-tier default that depends on provenance metadata the storage layer doesn't otherwise track.
The creation *command* itself is not gated by trust (there is no project row yet at that point,
and the command comes from Space's own template registry, not project-controlled content) — only
operations against the resulting registered project are.

## Consequences
- Every future feature that installs anything, runs anything project-provided, sources a shell
  file, loads project content into a privileged surface, or injects a secret must add a
  `GatedOperationKind` (if a new kind is needed) and call `assertTrusted` before acting — this is
  enforced by code review convention plus the fact that `TrustGateError` is the only exception
  type these functions are documented to throw for a trust failure, making a missing check
  visible in tests that assert on it (as `tests/integration/m4-project-handlers.test.ts` does).
- There is no UI-level way to "trust everything by default" — every untrusted project always
  requires an explicit per-project decision, which is intentionally friction-inducing.
- Because trust never expires or auto-reverts, a compromised-but-previously-trusted project stays
  trusted until a human revisits it. This is an accepted limitation consistent with spec 25.4
  ("workspace separation... does not contain malicious software") — Space's trust model defends
  against *accidentally* running unreviewed code once, not against a sustained supply-chain
  compromise of a project the user has already vetted.
- `project-binary`, `source-shell-file`, `load-project-content`, and `inject-secrets` remain
  unwired until the features that need them exist; anyone implementing those features must not
  skip the existing `assertTrusted` call site pattern.
