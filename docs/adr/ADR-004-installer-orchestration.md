# ADR-004: Installer orchestration

## Status
Decided (2026-07-12): manifest, scan, plan, verification, and receipt logic implemented and
unit-tested in `@space/environment` and `@space/storage`. The non-mutating scan (ONB-002) was
additionally run for real on this development machine (macOS arm64). No real installer
(Homebrew, Volta, WinGet, or an official fallback installer) has been executed against a live
machine — that requires explicit human confirmation in-session (see Consequences) and is an
open verification gap, not an unmade decision.

## Context
Spec section 40.4: decide package-manager commands, official fallback installers, elevation
strategy, download verification, and restart behaviour for onboarding (section 8).

## Decision drivers
- Trusted package managers or official signed installers only (section 25.3.5).
- HTTPS source verification, package identity allow-list, signed Space manifest.
- Space must not run the entire application as administrator; only the specific installer
  process may request elevation (section 8.5/8.6).
- Show elevation reason; verify result rather than trusting installer exit code zero
  (section 8.7, prohibited shortcut in section 39).

## Decision

### Package-manager commands
- **macOS**: Homebrew, invoked as a structured process (`brew install <formula>`, `shell:
  false`, arguments as an array — spec 25.3.2), never a shell string. Formula identities are
  fixed per manifest entry (`git`, `gh`) — no user- or project-supplied package names reach the
  command line.
- **Windows**: WinGet, invoked as `winget install --id <PackageId> -e --accept-package-agreements
  --accept-source-agreements`. `--id` plus `-e` (exact match) is the package identity allow-list
  mechanism (spec 25.3.5) — Space never resolves a WinGet package by fuzzy name search.
- **Node/npm**: never installed independently. Node is installed exclusively through
  `volta install node@lts` on both platforms (spec 16.3); npm arrives bundled with that Node
  install and is verify-only in the manifest (`installStrategies: []`).

### Official fallback installers
Used when the platform package manager is absent (Windows without WinGet) or for a tool that
has no package-manager strategy on that platform:
- **Git for Windows**: `https://git-scm.com/download/win` (signed `.exe`, silent flags
  `/VERYSILENT /NORESTART`).
- **GitHub CLI (Windows)**: `https://cli.github.com` signed installer.
- **Volta**: `https://get.volta.sh` (official install script) on macOS;
  `https://volta.sh` official Windows installer or the `Volta.Volta` WinGet package.

Every `InstallStrategy` in the manifest (`packages/environment/src/manifest.ts`) carries both
`officialSourceUrl` (HTTPS only, asserted by `manifest.test.ts`) and a human-readable
`sourceDescription` shown to the user before the step runs (spec 8.4: "showing the official
installer source and required changes").

### Elevation strategy
Space never elevates itself. `InstallStrategy.requiresElevation` and `.interactive` are
per-strategy metadata consumed by the (not-yet-built) step executor UI to warn the user and to
run that one step attached to a visible surface rather than a silently captured subprocess —
only the specific installer process (Homebrew's own `sudo` prompts, a Windows installer's own
UAC prompt) may request elevation. Space must not hide, simulate, or auto-answer those prompts
(spec 8.4). This is why Homebrew's own installer and Volta's installer script are marked
`interactive: true` in the manifest, while WinGet and Homebrew package installs (which don't
normally prompt) are not.

### Download verification
- Package-manager installs (Homebrew formulae, WinGet packages) inherit verification from their
  respective trusted repositories — Homebrew's formula checksums and WinGet's signed manifest
  index — so Space adds no separate download step for those paths.
- Official-installer fallbacks (Volta's install script, Git for Windows, GitHub CLI's Windows
  installer) are HTTPS-only by construction (`officialSourceUrl` asserted `https://` in tests),
  and the source host is fixed per manifest entry — there is no code path that accepts an
  installer URL from anywhere other than the packaged manifest (spec 25.3.5: "package identity
  allow-list"). **Gap**: actual download-then-checksum-verify-then-execute code for the
  official-installer `kind` has not been implemented — no real download has been exercised
  (see Consequences). Before this strategy is used against a live machine, it needs an explicit
  checksum or signature check step, not just an HTTPS URL.
- Verification of the *result* (spec 8.7, ONB-007) is unconditional and never derived from an
  installer's exit code: `verifyTool` (`packages/environment/src/verify.ts`) re-resolves the
  executable from a freshly constructed environment, re-runs a version command, and where safe a
  functional command, independent of what the installer reported. `orchestrator.ts`'s
  `executeStep` calls this regardless of `installResult.exitCode`, and classifies an
  installer-exit-0-but-verification-failed step as `partially_installed`
  (`needs_manual_remediation` if the installer itself also failed) — never `successful`. This is
  covered by tests asserting the outcome explicitly (spec section 39's named prohibited
  shortcut).

### Restart behaviour
`StepState` includes `needs_restart` (spec 8.6) for verification outcomes that require a new
shell/process environment to pick up a change (e.g. a freshly created Volta shim directory not
yet on the current process's PATH). The bootstrap run's persisted status
(`BootstrapRunStatus` in `@space/storage`) survives application and system restart by
construction — `BootstrapRepository.getLatestRun()` plus the pure `resumeAction` reducer in
`bootstrap-state.ts` is how the app decides what to resume into (re-scan, re-show the plan,
re-enter the installer loop, or re-run verification) without needing any in-memory state to
have survived the restart.

## Consequences
- The manifest, scan, plan builders (macOS and Windows), verification, step orchestration, and
  the resumable ONB-001 state machine are implemented and unit-tested with dependency-injected
  fakes for every OS/process/filesystem boundary (`packages/environment/src/*.test.ts`,
  95 tests) — none of that logic shells out for real in the test suite.
- The non-mutating scan (ONB-002) was additionally run for real against this development
  machine (macOS arm64, Node adapters in `node-adapters.ts`,
  `tests/integration/m3-real-scan.test.ts`): it correctly found Homebrew, Git 2.54.0, GitHub CLI
  2.95.0, and Node/npm on this machine, correctly reported Volta as absent, and made no PATH,
  filesystem, or process-state changes.
- **No real installer has been executed.** Running Homebrew's installer, `brew install`,
  Volta's install script, or WinGet against a live machine is an irreversible, machine-scoped
  change and was deliberately left unexercised in this milestone — it requires the user's
  explicit live confirmation in a session with a real target machine, per the safety boundary
  this work was scoped under. The macOS install-step wiring is exercised only against fakes; the
  entire Windows path (WinGet detection, build-number gating, ConPTY check, ADR-004's Windows
  decisions above) is unverified by execution on any real Windows machine and should be treated
  as "implemented per spec, not proven" until run there.
- Official-installer download verification (checksum/signature check before executing a
  downloaded script or binary) is designed for but not implemented — flagged above as a gap to
  close before the `official-installer` strategy kind is ever exercised for real.
- The step executor's UI-facing behaviour for `interactive: true` steps (attaching Homebrew's or
  Volta's installer to a real, visible terminal surface rather than a captured subprocess) is
  specified by the `interactive` flag but not wired to any actual terminal surface yet —
  `@space/terminal` (spec section 15) is a later-phase package. Shell-integration steps
  (`kind: 'shell-integration'`) are likewise planned but marked `deferredImplementation: true`
  and always skipped by the orchestrator rather than faked as successful.
