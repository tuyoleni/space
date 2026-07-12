# P0-B runbook: GitHub multi-account isolation spike

Spec section 36.1.2. Requires a human operator with **two real GitHub
accounts** (use disposable test accounts, never client accounts) on both
macOS and Windows. Results feed the final decision in ADR-002.

## Already verified without credentials (2026-07-12, macOS, gh 2.95.0)

- `GH_CONFIG_DIR` fully isolates gh *configuration*: `gh config set` in
  workspace root A is invisible to workspace root B, files are created
  only under the given root, and the user's normal `~/.config/gh` is
  untouched.
- What remains unproven is **token storage**: `gh auth login` may write
  the token to the OS credential store (macOS Keychain / Windows
  Credential Manager) keyed in a way that ignores `GH_CONFIG_DIR`.

## Protocol (repeat on macOS and Windows)

Setup: two empty directories, `WS_A/gh` and `WS_B/gh`. Prefix every
command with the workspace's `GH_CONFIG_DIR` (PowerShell:
`$env:GH_CONFIG_DIR = ...`).

1. `GH_CONFIG_DIR=$WS_A/gh gh auth login` — log in as **account A**
   (browser flow). Then the same for `WS_B` with **account B**.
2. `gh auth status` under each root. PASS: each root reports only its own
   account.
3. `gh api user --jq .login` under each root. PASS: A and B respectively.
4. `gh repo list --limit 5` under each root. PASS: each account's repos.
5. Token storage inspection:
   - macOS: `security find-generic-password -s 'gh:github.com' -g` and
     Keychain Access; note whether one or two entries exist and how keyed.
   - Windows: Credential Manager > Windows Credentials; same question.
   - Also check whether either root's `hosts.yml` contains a plaintext
     `oauth_token` (insecure-storage fallback).
6. Git credential helper: in a repo under each workspace, run
   `GIT_CONFIG_GLOBAL=<ws git config> gh auth setup-git`, then
   clone/fetch/push a private repo of the matching account. PASS: each
   workspace pushes as its own account; FAIL if either operation uses the
   other account's token.
7. Cross-contamination: while both roots are logged in, repeat steps 2-4
   twice more, alternating roots. PASS: results never swap.
8. Logout `WS_A` (`gh auth logout`); verify `WS_B` still works.

## Recording results

Fill in the Decision section of ADR-002 with: whether the OS credential
store keyed entries per config dir or collided; whether the plaintext
fallback was triggered; and whether the GH_TOKEN-injection fallback design
(spec section 5.6) must be implemented for V1.
