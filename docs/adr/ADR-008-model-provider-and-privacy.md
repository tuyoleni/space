# ADR-008: Model provider and privacy

## Status
Accepted — resolved during M7 (Phase 6: intent and agent layer)

## Context
Spec section 40.8: decide local/remote model support, prompt content policy, redaction,
retention, and opt-in. Section 13.3 and 19.3 require that if a remote model is used, the user
must know which files/diff fragments are sent, secrets and known sensitive values must be
redacted, binary files must not be sent by default, raw credentials/environment files/key
material must never be sent, and the operation must be cancellable and auditable.

## Decision

**Local/rule-based grouping is the real default, not a fallback.** `@space/agent`'s
`generateRuleBasedIntentGroups` (`change-intent.ts`) is deterministic, has no network dependency,
and requires no model of any kind. It is what runs every time a user opens the intent view. This
inverts the framing spec 13.3 uses ("a local or offline grouping fallback must exist, even if less
sophisticated") — in this implementation the local path is not a degraded fallback behind a
model, it is the only path wired up. A remote or local model, if ever connected, would only ever
*add* proposed groups on top of the rule-based ones (`applyModelProposals`); it never replaces
them and the UI never blocks on a model call.

**Model provider is an architecturally-supported, not-yet-connected seam.** `ModelProvider`
(`model-provider.ts`) is a narrow DI interface — `proposeIntentGroups` and
`generateCommitMessage` — mirroring the `GhExecutor`/`GitExecutor` pattern the rest of the
codebase uses for every other external system. No implementation of it in this codebase calls a
real model API; `main.ts` constructs `agentHandlers` with no `modelProvider` configured, and
`generateIntentGroupsWithModel` degrades to the plain rule-based groups when none is supplied. The
only implementation that exists is `FakeModelProvider`, a canned, offline stand-in used by every
test in this milestone. Connecting a real provider is future work and requires, at minimum: an
explicit per-workspace opt-in setting (off by default), a documented provider identity and data
handling policy for whichever vendor is chosen, and a real network client behind this same
interface — none of which this milestone builds or needs to build, since the safety properties
below do not depend on which provider (if any) eventually fills the seam.

**Prompt content policy: minimum evidence, computed before any provider is invoked.**
`buildModelDisclosure` (`model-privacy.ts`) is the one function that would ever decide what leaves
the machine, and it runs whether or not a real provider exists — it is exercised directly by
`FakeModelProvider`-backed tests today and would be the unconditional input to a real provider's
request later. It takes only the evidence the user has *actually selected* (never "the whole
repository" or "the whole file") and returns exactly the disclosed fragments plus a separate,
explicit list of what was excluded and why — this excluded list is precisely spec 13.3's "the user
must know which files or diff fragments are sent" made concrete: what's absent is as visible as
what's present.

**Binary and known-sensitive files are excluded outright, never conditionally.**
`isEligibleForModel` rejects binary files and anything matching `isSensitivePath`
(`@space/workspace-runner`'s `redaction.ts`: `.env*`, `id_rsa`/`id_ed25519` and other SSH key
files, `*.pem`/`*.key`/`*.pfx`/`*.p12`, `credentials`/`secrets` files, `.npmrc`, `.netrc`,
`.aws/credentials`, `.git-credentials`) before any content is inspected. This is a path-based,
content-independent gate — it does not depend on redaction catching a secret; a `.env` file is
never disclosed even if it happens to contain no live secrets that day.

**Redaction is defence in depth on top of exclusion, not a replacement for it.** Every disclosed
fragment additionally passes through `redactSecretPatterns`, a regex-based scan for common secret
shapes (PEM private key blocks, AWS/GitHub-style tokens, JWTs, generic `key: value`/`key=value`
assignments) that were never explicitly registered with a `RedactionRegistry` the way a spawned
process's environment secrets are. Pattern matching is necessarily incomplete — it only catches
shapes it recognizes — which is exactly why sensitive-path exclusion above does not rely on it.

**Auditability and cancellation.** `buildAuditEntry`/`completeAuditEntry` record only counts and
file paths (never redacted or raw text) and a `pending`/`completed`/`cancelled`/`failed` outcome —
satisfying spec 19.3's "external model calls are logged as metadata, not raw sensitive content."
This reuses the existing `Operation`/receipt mechanism (`@space/storage`'s `withReceipt`, spec
section 33) rather than a parallel audit table: `OperationState` already includes `cancelled`, so a
model request is recorded exactly like any other mutating-or-not operation Space already tracks,
with no new storage schema needed for it. `ModelRequestCancellation` is a simple cooperative token
a real provider call would be expected to poll; no real call exists yet to exercise it against a
network request, so it is unit-tested standalone (`model-privacy.test.ts`).

**Retention.** No prompt/response content is persisted anywhere by this milestone: the audit
record is metadata-only (spec 19.3) and there is no cache or history of disclosed fragments beyond
the lifetime of one request. If a real provider is connected later and its own API retains
prompts server-side, that is a per-provider data processing fact to document in this ADR at that
time — it is out of this implementation's control and must not be assumed away.

**Opt-in.** Because no remote provider is wired up, there is currently nothing to opt into for
model calls specifically. The one related opt-in this milestone *does* build is standing
permissions for remote agent actions (`AgentStandingPermission`, spec 19.2.3): narrow (one action
type, scoped to a workspace and optionally a project), explicitly granted, and revocable at any
time (`packages/storage/src/schema/0006_agent.ts`, `AgentPermissionRepository`). It is not a
model-privacy opt-in — a standing permission never applies to what content a model would see,
only to whether a `remote`-risk agent action requires a fresh per-call confirmation — but it is
built to the same "narrow and revocable" standard spec 19.2.3 sets, and is the template a future
"allow this workspace to use model X" opt-in would follow.

**Non-negotiable floor.** Independent of whether a model provider is ever connected: secret values
never leave the machine (registered secrets via `RedactionRegistry`, pattern-matched secrets via
`redactSecretPatterns`, and whole sensitive files via `isSensitivePath`, three overlapping layers
rather than one); model output is never treated as executable authority (`AgentActionSchema`
validates every action before dispatch, and `dispatchAgentAction` recomputes each action's true
risk from its type/parameters rather than trusting a model-supplied `risk` label, spec 25.3.6);
and destructive actions require a human confirmation every single time, with no standing
permission ever able to substitute for it (`assertAgentActionConfirmed`,
`@space/domain/agent-confirmation.ts`).

## Consequences
- Nobody using Space today gets model-assisted intent grouping, commit-message drafting, or any
  other model-backed assistance — only the deterministic rule-based grouping. This is a deliberate
  scope boundary for M7, not an oversight: the milestone's exit criteria (traceability, secret
  exclusion, confirmed high-impact actions) do not require a working model integration, and this
  milestone's own hard safety boundary prohibits calling a real provider or using a real API key
  during its build/test loop.
- Connecting a real `ModelProvider` implementation later is additive (new file implementing the
  existing interface, wired into `createAgentHandlers`'s `modelProvider` option) and does not
  require touching `model-privacy.ts`'s policy, `change-intent.ts`'s rule-based default, or any of
  the confirmation/trust gates — the seam was built to make that true.
- The regex-based secret patterns in `redactSecretPatterns` will miss secret shapes it doesn't
  recognize (a bespoke internal token format, for example). Sensitive-path exclusion is the
  stronger, content-independent guarantee for the file categories it covers; pattern redaction is
  best-effort for everything else. A future iteration could add a pluggable/extensible pattern
  list (e.g. per-workspace custom patterns) if this proves insufficient in practice.
- The model-request audit trail piggybacks on the general `Operation` receipt mechanism rather
  than getting a dedicated table. If per-model-request analytics ever need richer structure (e.g.
  token counts, provider identity, latency), that likely warrants a dedicated additive migration
  at that time rather than overloading `operations.partialState`.
