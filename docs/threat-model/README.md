# Threat model

Source: `Space_Product_Engineering_Specification_v1.0.pdf`, section 25.

## Protected assets
GitHub/cloud tokens, SSH private keys, signing keys, environment secrets,
source code, user files outside registered projects, remote repositories
and deployment environments, Git history integrity, package-manager and
system integrity.

## Threat actors and failure sources
Malicious/compromised project repository; malicious dependency or
lifecycle script; prompt-injected model output; renderer XSS; compromised
external website opened inside the app; command injection through branch,
path, repository, or issue text; credential leakage through logs or process
environment; wrong-workspace user error; untrusted installer or
supply-chain compromise; native-module crash or memory issue.

## Mitigations
Tracked per-milestone as they are implemented. See:
- M2 (secure application foundation): renderer compromise, command
  injection, and IPC sender validation mitigations.
- M4 (project and terminal foundation): malicious-project trust gate.
- M6 (GitHub workflow): wrong-workspace/account confirmation before remote
  actions.
- M7 (intent and agent layer): model safety (typed plans only, permission
  gates, secret stripping, human confirmation for high-impact actions).

This document must be updated whenever a new mitigation lands or a new
threat is identified — it is a living artifact, not a one-time checklist.
