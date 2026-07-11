# ADR-004: Installer orchestration

## Status
Pending — resolved during M3 (Phase 2: computer bootstrap)

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
_To be filled in during M3 implementation._

## Consequences
_Pending._
